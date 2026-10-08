import { useCallback, useEffect, useMemo, useState } from "react";

import { parseTimestamp } from "../datetime";
import type { PaymentAccountComponent, PaymentAccountProps } from "../ui";
import { useBusinessId } from "./business";
import { strings } from "../strings";
import type { ApiLike } from "../api";

interface ConnectStatus {
    connected: boolean;
    charges_enabled: boolean;
    payouts_enabled: boolean;
    details_submitted: boolean;
    kyc_status: string;
    disabled_reason: string | null;
    currently_due: string[];
    past_due: string[];
    pending_verification: string[];
    current_deadline: string | null;
    available_cents: number | null;
}

/** `null` while loading, `"error"` if the fetch failed; bump `reloadKey` to refetch. */
function useConnectStatus(api: ApiLike, reloadKey = 0): ConnectStatus | "error" | null {
    const [status, setStatus] = useState<ConnectStatus | "error" | null>(null);
    const businessId = useBusinessId();
    useEffect(() => {
        setStatus(null);
        let active = true;
        api.get<ConnectStatus>("/v1/connect/status")
            .then((value) => {
                if (active) setStatus(value);
            })
            .catch(() => {
                if (active) setStatus("error");
            });
        return () => {
            active = false;
        };
    }, [api, reloadKey, businessId]);
    return status;
}

const g = strings.gettingPaid;

const REQUIREMENT_LABELS: Record<string, string> = {
    external_account: g.reqExternalAccount,
    "business_profile.url": g.reqBusinessWebsite,
    "business_profile.mcc": g.reqBusinessCategory,
    "business_profile.product_description": g.reqProductDescription,
    "individual.id_number": g.reqIdNumber,
    "individual.verification.document": g.reqPhotoId,
    "individual.verification.additional_document": g.reqProofOfAddress,
    "individual.address.line1": g.reqHomeAddress,
    "company.tax_id": g.reqBusinessNumber,
    "tos_acceptance.date": g.reqTosAcceptance,
};

function requirementLabel(key: string): string {
    const known = REQUIREMENT_LABELS[key];
    if (known !== undefined) return known;
    if (key.startsWith("individual.dob") || key.startsWith("person.dob")) return g.reqDateOfBirth;
    const tail = key.split(".").pop() ?? key;
    const words = tail.replace(/_/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
}

type ConnectPhase =
    | "loading"
    | "error"
    | "not_connected"
    | "in_progress"
    | "pending"
    | "restricted"
    | "enabled"
    | "disabled";

interface ConnectRequirement {
    key: string;
    label: string;
    why: string;
    pastDue: boolean;
    icon: "bank" | "user";
}

export interface GettingPaidView {
    phase: ConnectPhase;
    title: string;
    message: string;
    requirements: ConnectRequirement[];
    deadline: Date | null;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    availableCents: number | null;
    refreshing: boolean;
    finish: () => void;
    account: ReturnType<typeof usePaymentAccount>;
    refresh: () => void;
}

function phaseOf(status: ConnectStatus): ConnectPhase {
    if (!status.connected) return "not_connected";
    switch (status.kyc_status) {
        case "pending":
        case "restricted":
        case "enabled":
        case "disabled":
            return status.kyc_status;
        default:
            return "in_progress";
    }
}

const TITLES: Partial<Record<ConnectPhase, string>> = {
    in_progress: g.titleInProgress,
    pending: g.titlePending,
    restricted: g.pausedTitle,
    enabled: g.readyTitle,
    disabled: g.titleDisabled,
};

export function useGettingPaid(api: ApiLike): GettingPaidView {
    const [reloadKey, setReloadKey] = useState(0);
    const status = useConnectStatus(api, reloadKey);

    const refresh = useCallback(() => {
        setReloadKey((k) => k + 1);
    }, []);
    const account = usePaymentAccount(api, refresh);
    const phase: ConnectPhase =
        status === null ? "loading" : status === "error" ? "error" : phaseOf(status);
    const s = status !== null && status !== "error" ? status : null;
    const deadline =
        s?.current_deadline === null || s?.current_deadline === undefined
            ? null
            : parseTimestamp(s.current_deadline);
    const past = new Set(s?.past_due ?? []);
    const keys = [...new Set([...(s?.past_due ?? []), ...(s?.currently_due ?? [])])];
    const message =
        phase === "not_connected"
            ? g.phaseNotConnected
            : phase === "in_progress"
              ? g.phaseInProgress
              : phase === "pending"
                ? g.phasePending
                : phase === "disabled"
                  ? g.phaseDisabled
                  : phase === "restricted"
                    ? deadline === null
                        ? g.pausedBodyNoDate
                        : g.pausedBody(deadline)
                    : g.readyBody;
    return {
        phase,
        title: TITLES[phase] ?? "",
        message,
        requirements: keys.map((key) => ({
            key,
            label: requirementLabel(key),
            why: g.reqWhy[key] ?? "",
            pastDue: past.has(key),
            icon: key === "external_account" ? "bank" : "user",
        })),
        deadline,
        chargesEnabled: s?.charges_enabled ?? false,
        payoutsEnabled: s?.payouts_enabled ?? false,
        availableCents: s?.available_cents ?? null,
        refreshing: status === null,
        finish: () => {
            account.open("onboarding");
        },
        account,
        refresh,
    };
}

export function usePaymentAccount(api: ApiLike, onClose?: () => void) {
    const businessId = useBusinessId();
    const [selection, setSelection] = useState<{
        component: PaymentAccountComponent;
        businessId: string;
        nonce: number;
    } | null>(null);
    const context = useMemo(() => ({ active: true }), [businessId, selection]);
    useEffect(() => {
        context.active = true;
        return () => {
            context.active = false;
        };
    }, [context]);
    const fetchClientSecret = useCallback(async (): Promise<string> => {
        if (!context.active || selection?.businessId !== businessId) {
            throw new Error(strings.paymentAccount.expired);
        }
        const { client_secret: secret } = await api.post<{ client_secret: string }>(
            "/v1/connect/session",
            { component: selection.component },
        );
        const isActive = (): boolean => context.active;
        if (!isActive()) throw new Error(strings.paymentAccount.expired);
        return secret;
    }, [api, context, selection, businessId]);
    const close = useCallback(() => {
        context.active = false;
        setSelection(null);
        onClose?.();
    }, [context, onClose]);
    const props: PaymentAccountProps | null =
        selection !== null && selection.businessId === businessId
            ? {
                  component: selection.component,
                  scope: `${selection.businessId}:${selection.component}:${String(selection.nonce)}`,
                  fetchClientSecret,
                  onClose: close,
              }
            : null;
    return {
        props,
        ready: businessId !== null,
        open: (component: PaymentAccountComponent): void => {
            if (businessId === null) return;
            context.active = false;
            setSelection({ component, businessId, nonce: Date.now() });
        },
        close,
    };
}
