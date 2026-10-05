import { useCallback, useEffect, useState } from "react";

import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { ApiLike } from "../api";

export interface ConnectStatus {
    connected: boolean;
    charges_enabled: boolean;
    payouts_enabled: boolean;
    details_submitted: boolean;
    kyc_status: string;
    disabled_reason: string | null;
    currently_due: string[];
    past_due: string[];
    pending_verification: string[];
}

/** Provider's Stripe Connect status (REST). `null` = loading, `"error"` = the fetch failed.
 *  Bump `reloadKey` to refetch (e.g. after onboarding). */
export function useConnectStatus(api: ApiLike, reloadKey = 0): ConnectStatus | "error" | null {
    const [status, setStatus] = useState<ConnectStatus | "error" | null>(null);
    useEffect(() => {
        api.get<ConnectStatus>("/v1/connect/status")
            .then(setStatus)
            .catch(() => {
                setStatus("error");
            });
    }, [api, reloadKey]);
    return status;
}

export interface OnboardingLink {
    url: string;
    charges_enabled: boolean;
}

export function startOnboarding(api: ApiLike): Promise<OnboardingLink> {
    return api.post<OnboardingLink>("/v1/connect/onboard", {});
}

const REQUIREMENT_LABELS: Record<string, string> = {
    external_account: strings.gettingPaid.reqExternalAccount,
    "business_profile.url": strings.gettingPaid.reqBusinessWebsite,
    "business_profile.mcc": strings.gettingPaid.reqBusinessCategory,
    "business_profile.product_description": strings.gettingPaid.reqProductDescription,
    "individual.id_number": strings.gettingPaid.reqIdNumber,
    "individual.verification.document": strings.gettingPaid.reqPhotoId,
    "individual.verification.additional_document": strings.gettingPaid.reqProofOfAddress,
    "individual.address.line1": strings.gettingPaid.reqHomeAddress,
    "company.tax_id": strings.gettingPaid.reqBusinessNumber,
    "tos_acceptance.date": strings.gettingPaid.reqTosAcceptance,
};

/** Humanize a Stripe requirement key (e.g. `individual.dob.day`) into provider-facing copy. */
export function formatRequirement(key: string): string {
    const known = REQUIREMENT_LABELS[key];
    if (known !== undefined) return known;
    if (key.startsWith("individual.dob") || key.startsWith("person.dob"))
        return strings.gettingPaid.reqDateOfBirth;
    const tail = key.split(".").pop() ?? key;
    const words = tail.replace(/_/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
}

export type ConnectPhase =
    | "loading"
    | "error"
    | "not_connected"
    | "in_progress"
    | "pending"
    | "restricted"
    | "enabled"
    | "disabled";

export interface ConnectOnboarding {
    phase: ConnectPhase;
    busy: boolean;
    error: string | null;
    headline: string;
    ctaLabel: string;
    showCta: boolean;
    requirements: string[];
    payoutsEnabled: boolean;
    connect: () => void;
    refresh: () => void;
}

const HEADLINES: Record<Exclude<ConnectPhase, "loading" | "error">, string> = {
    not_connected: strings.gettingPaid.headlineNotConnected,
    in_progress: strings.gettingPaid.headlineInProgress,
    pending: strings.gettingPaid.headlinePending,
    restricted: strings.gettingPaid.headlineRestricted,
    enabled: strings.gettingPaid.headlineEnabled,
    disabled: strings.gettingPaid.headlineDisabled,
};

function phaseOf(status: ConnectStatus): ConnectPhase {
    if (!status.connected) return "not_connected";
    switch (status.kyc_status) {
        case "pending":
        case "restricted":
        case "enabled":
        case "disabled":
            return status.kyc_status;
        default:
            return "in_progress"; // not_started, but the account exists
    }
}

/** Shared Stripe Connect onboarding view-model: the KYC phase, what Stripe still needs, the connect
 *  action, and error copy. `openUrl` is injected per platform (web `location.href`, mobile `Linking`). */
export function useConnectOnboarding(
    api: ApiLike,
    openUrl: (url: string) => void,
): ConnectOnboarding {
    const [reloadKey, setReloadKey] = useState(0);
    const status = useConnectStatus(api, reloadKey);
    const { busy, error, run } = useAsyncAction();

    const phase: ConnectPhase =
        status === null ? "loading" : status === "error" ? "error" : phaseOf(status);

    const requirements =
        status !== null && status !== "error"
            ? [...new Set([...status.currently_due, ...status.past_due].map(formatRequirement))]
            : [];

    const ctaLabel =
        phase === "restricted"
            ? strings.gettingPaid.finishVerification
            : phase === "in_progress"
              ? strings.gettingPaid.continueSetup
              : strings.gettingPaid.connectStripe;

    const showCta = phase === "not_connected" || phase === "in_progress" || phase === "restricted";
    const headline = phase === "loading" || phase === "error" ? "" : HEADLINES[phase];
    const payoutsEnabled = status !== null && status !== "error" && status.payouts_enabled;

    const connect = (): void => {
        run(
            async () => {
                const { url } = await startOnboarding(api);
                openUrl(url);
            },
            { errorMessage: strings.gettingPaid.onboardingStartError },
        );
    };

    const refresh = useCallback((): void => {
        setReloadKey((k) => k + 1);
    }, []);

    return {
        phase,
        busy,
        error,
        headline,
        ctaLabel,
        showCta,
        requirements,
        payoutsEnabled,
        connect,
        refresh,
    };
}
