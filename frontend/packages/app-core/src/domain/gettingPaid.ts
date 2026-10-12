import { useCallback, useEffect, useMemo, useState } from "react";

import { formatDate, parseTimestamp, useBusinessZone } from "../datetime";
import type { PaymentAccountComponent, PaymentAccountProps, PaymentNoticesProps } from "../ui";
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

interface RequirementCopy {
    label: () => string;
    why?: () => string;
}

const REQUIREMENTS: readonly (readonly [string, RequirementCopy])[] = [
    ["external_account", { label: () => g.reqExternalAccount, why: () => g.reqWhy.bankAccount }],
    ["defaults.profile.business_url", { label: () => g.reqBusinessWebsite }],
    ["configuration.merchant.mcc", { label: () => g.reqBusinessCategory }],
    ["defaults.profile.product_description", { label: () => g.reqProductDescription }],
    [
        "identity.attestations.terms_of_service",
        { label: () => g.reqTosAcceptance, why: () => g.reqWhy.terms },
    ],
    [
        "identity.individual.id_numbers",
        { label: () => g.reqIdNumber, why: () => g.reqWhy.idNumber },
    ],
    [
        "identity.individual.documents.primary_verification",
        { label: () => g.reqPhotoId, why: () => g.reqWhy.photoId },
    ],
    [
        "identity.individual.documents.secondary_verification",
        { label: () => g.reqProofOfAddress, why: () => g.reqWhy.proofOfAddress },
    ],
    ["identity.business_details.id_numbers", { label: () => g.reqBusinessNumber }],
    ["identity.business_details.registered_name", { label: () => g.reqBusinessName }],
    ["identity.business_details.address", { label: () => g.reqBusinessAddress }],
    ["identity.entity_type", { label: () => g.reqBusinessType }],
];

const FIELDS: Readonly<Record<string, () => string>> = {
    date_of_birth: () => g.reqDateOfBirth,
    address: () => g.reqHomeAddress,
    given_name: () => g.reqFirstName,
    surname: () => g.reqLastName,
    email: () => g.reqEmail,
    phone: () => g.reqPhone,
    title: () => g.reqJobTitle,
};

/** Stripe's Accounts v2 requirement codes, such as `identity.individual.date_of_birth.day`. */
export function requirementCopy(key: string): { label: string; why: string } {
    const match = REQUIREMENTS.find(
        ([prefix]) => key === prefix || key.startsWith(`${prefix}.`),
    )?.[1];
    if (match !== undefined) return { label: match.label(), why: match.why?.() ?? "" };
    const field = key
        .split(".")
        .map((segment) => FIELDS[segment])
        .find((label) => label !== undefined);
    return { label: field?.() ?? g.reqOther, why: "" };
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
    notices: PaymentNotices | null;
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
    const notices = usePaymentNotices(
        api,
        s?.connected ?? false,
        noticesNeedAttention(phase, keys.length),
    );
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
            ...requirementCopy(key),
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
        notices,
        refresh,
    };
}

/** Stripe's banner lists requirements due after onboarding and risk reviews, never the first setup. */
export function noticesNeedAttention(phase: ConnectPhase, due: number): boolean {
    return phase === "restricted" || phase === "disabled" || (phase === "enabled" && due > 0);
}

type PaymentNotices = Omit<PaymentNoticesProps, "onReview" | "reviewing">;

/** The account notices banner Stripe requires where owners see payments, once an account exists. */
export function usePaymentNotices(
    api: ApiLike,
    connected: boolean,
    attention: boolean,
): PaymentNotices | null {
    const businessId = useBusinessId();
    const fetchClientSecret = useCallback(async (): Promise<string> => {
        const { client_secret: secret } = await api.post<{ client_secret: string }>(
            "/v1/connect/session",
            { component: "notices" },
        );
        return secret;
    }, [api]);
    if (!connected || businessId === null) return null;
    return { scope: `${businessId}:notices`, fetchClientSecret, attention };
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
