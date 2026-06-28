import { useQuery } from "@powersync/react";
import { useCallback, useEffect, useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import type { ApiLike } from "../util/api";
import type { Intent } from "../util/intent";

export interface ConnectStatus {
    connected: boolean;
    charges_enabled: boolean;
}

/** Provider's Stripe Connect status (REST). `null` = loading, `"error"` = the fetch failed.
 *  Bump `reloadKey` to refetch (e.g. after onboarding). */
export function useConnectStatus(api: ApiLike, reloadKey = 0): ConnectStatus | "error" | null {
    const [status, setStatus] = useState<ConnectStatus | "error" | null>(null);
    useEffect(() => {
        void api
            .get<ConnectStatus>("/v1/connect/status")
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

export type ConnectPhase = "loading" | "error" | "not_connected" | "in_progress" | "enabled";

export interface ConnectOnboarding {
    phase: ConnectPhase;
    busy: boolean;
    error: string | null;
    ctaLabel: string;
    connect: () => void;
    refresh: () => void;
}

/** Shared Stripe Connect onboarding view-model: the load phase + the connect action + error copy.
 *  `openUrl` is injected per platform (web `location.href`, mobile `Linking.openURL`). */
export function useConnectOnboarding(
    api: ApiLike,
    openUrl: (url: string) => void,
): ConnectOnboarding {
    const [reloadKey, setReloadKey] = useState(0);
    const status = useConnectStatus(api, reloadKey);
    const { busy, error, run } = useAsyncAction();

    const phase: ConnectPhase =
        status === null
            ? "loading"
            : status === "error"
              ? "error"
              : status.charges_enabled
                ? "enabled"
                : status.connected
                  ? "in_progress"
                  : "not_connected";

    const ctaLabel = phase === "in_progress" ? "Continue setup" : "Connect Stripe";

    const connect = (): void => {
        void run(
            async () => {
                const { url } = await startOnboarding(api);
                openUrl(url);
            },
            { errorMessage: "Couldn't start Stripe onboarding. Please try again." },
        );
    };

    const refresh = useCallback((): void => {
        setReloadKey((k) => k + 1);
    }, []);

    return { phase, busy, error, ctaLabel, connect, refresh };
}

export function refundPayment(
    api: ApiLike,
    paymentId: string,
): Promise<{ refund_id: string; status: string }> {
    return api.post<{ refund_id: string; status: string }>(`/v1/payments/${paymentId}/refund`, {});
}

export interface PaymentRow {
    id: string;
    kind: string;
    parent_payment_id: string | null;
    amount_cents: number;
    currency: string;
    status: string;
    method: string;
    created_at: string;
}

const INVOICE_PAYMENTS_SQL = `
SELECT id, kind, parent_payment_id, amount_cents, currency, status, method, created_at
FROM payments WHERE invoice_id = ? ORDER BY created_at`;

export function useInvoicePayments(invoiceId: string): PaymentRow[] {
    return useQuery<PaymentRow>(INVOICE_PAYMENTS_SQL, [invoiceId]).data;
}

/** A refund row (a negative entry against a prior payment), vs an original charge. */
export function isRefundRow(payment: { kind: string }): boolean {
    return payment.kind === "refund";
}

/** Refundable only once: a succeeded non-refund payment with no sibling refund yet (matches the
 *  backend's one-refund-per-payment 409 — so the button disappears after a refund posts). */
export function isRefundable(payment: PaymentRow, allPayments: PaymentRow[]): boolean {
    return (
        payment.status === "succeeded" &&
        !isRefundRow(payment) &&
        !allPayments.some((p) => p.parent_payment_id === payment.id)
    );
}

/** Only owners and admins may issue refunds (matches the backend's payment role gate). */
export function canManagePayments(role: string | null): boolean {
    return role === "owner" || role === "admin";
}

export function paymentStatusIntent(status: string): Intent {
    switch (status) {
        case "succeeded":
            return "success";
        case "pending":
            return "accent";
        case "failed":
        case "canceled":
            return "danger";
        default:
            return "neutral"; // refunded
    }
}

/** An invoice can be paid when it's been issued and still owes a balance. */
export function isPayable(row: { status: string; balance_cents: number | null }): boolean {
    return (
        row.status !== "draft" &&
        row.status !== "void" &&
        row.status !== "paid" &&
        (row.balance_cents ?? 0) > 0
    );
}

export type PayMethod = "interac" | "card";

/** Ranked pay methods for the public page: Interac first (no fee), card only when enabled. */
export function payMethods(invoice: { accepts_card: boolean }): PayMethod[] {
    return invoice.accepts_card ? ["interac", "card"] : ["interac"];
}

/** Public pay-page URL for an invoice token. `base` is the public-web origin each app supplies
 *  (web `window.location.origin`; mobile a configured URL). */
export function payLinkUrl(base: string, token: string): string {
    return `${base.replace(/\/+$/, "")}/pay/${token}`;
}
