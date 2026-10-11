import { useCallback, useEffect, useMemo, useState } from "react";

import { formatDate, parseTimestamp, useBusinessZone } from "../datetime";
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
    get external_account() {
        return g.reqExternalAccount;
    },
    get "business_profile.url"() {
        return g.reqBusinessWebsite;
    },
    get "business_profile.mcc"() {
        return g.reqBusinessCategory;
    },
    get "business_profile.product_description"() {
        return g.reqProductDescription;
    },
    get "individual.id_number"() {
        return g.reqIdNumber;
    },
    get "individual.verification.document"() {
        return g.reqPhotoId;
    },
    get "individual.verification.additional_document"() {
        return g.reqProofOfAddress;
    },
    get "individual.address.line1"() {
        return g.reqHomeAddress;
    },
    get "company.tax_id"() {
        return g.reqBusinessNumber;
    },
    get "tos_acceptance.date"() {
        return g.reqTosAcceptance;
    },
};

const FIELD_LABELS: Readonly<Record<string, () => string>> = {
    first_name: () => g.reqFirstName,
    last_name: () => g.reqLastName,
    email: () => g.reqEmail,
    phone: () => g.reqPhone,
    title: () => g.reqJobTitle,
    business_type: () => g.reqBusinessType,
};

function requirementLabel(key: string): string {
    const known = REQUIREMENT_LABELS[key];
    if (known !== undefined) return known;
    if (key.startsWith("individual.dob") || key.startsWith("person.dob")) return g.reqDateOfBirth;
    if (key === "company.name") return g.reqBusinessName;
    if (key.startsWith("company.address")) return g.reqBusinessAddress;
    if (key.includes(".address.")) return g.reqHomeAddress;
    return FIELD_LABELS[key.split(".").pop() ?? key]?.() ?? g.reqOther;
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
    get in_progress() {
        return g.titleInProgress;
    },
    get pending() {
        return g.titlePending;
    },
    get restricted() {
        return g.pausedTitle;
    },
    get enabled() {
        return g.readyTitle;
    },
    get disabled() {
        return g.titleDisabled;
    },
};

export function useGettingPaid(api: ApiLike): GettingPaidView {
    const [reloadKey, setReloadKey] = useState(0);
    const status = useConnectStatus(api, reloadKey);
    const zone = useBusinessZone();

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
                        : g.pausedBody(formatDate(deadline, zone))
                    : g.readyBody;
    return {
        phase,
        title: TITLES[phase] ?? "",
        message,
        requirements: keys.map((key) => ({
            key,
            label: requirementLabel(key),
            why: g.reqWhy[key.replaceAll(".", "_")] ?? "",
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
