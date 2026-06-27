import { useQuery } from "@powersync/react";
import { useEffect, useState } from "react";

import type { ApiLike } from "../util/api";
import type { Intent } from "../util/intent";

export interface ConnectStatus {
    connected: boolean;
    charges_enabled: boolean;
}

/** Provider's Stripe Connect status (REST). Bump `reloadKey` to refetch (e.g. after onboarding). */
export function useConnectStatus(api: ApiLike, reloadKey = 0): ConnectStatus | null {
    const [status, setStatus] = useState<ConnectStatus | null>(null);
    useEffect(() => {
        void api
            .get<ConnectStatus>("/v1/connect/status")
            .then(setStatus)
            .catch(() => {
                setStatus(null);
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

export interface PayIntent {
    payment_id: string;
    client_secret: string;
    amount_cents: number;
}

/** Create a PaymentIntent for an invoice (full balance, or `amountCents` for a partial/deposit).
 *  The returned client_secret is confirmed by the platform's Stripe Elements / Terminal flow. */
export function payInvoice(
    api: ApiLike,
    invoiceId: string,
    amountCents?: number,
): Promise<PayIntent> {
    const q = amountCents !== undefined ? `?amount_cents=${amountCents}` : "";
    return api.post<PayIntent>(`/v1/payments/invoice/${invoiceId}${q}`, {});
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
    amount_cents: number;
    status: string;
    method: string;
    created_at: string;
}

const INVOICE_PAYMENTS_SQL = `
SELECT id, kind, amount_cents, status, method, created_at
FROM payments WHERE invoice_id = ? ORDER BY created_at`;

export function useInvoicePayments(invoiceId: string): PaymentRow[] {
    return useQuery<PaymentRow>(INVOICE_PAYMENTS_SQL, [invoiceId]).data;
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
