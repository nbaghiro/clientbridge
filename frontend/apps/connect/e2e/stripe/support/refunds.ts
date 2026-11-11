import { select } from "../../../../web/e2e/support/db";
import { type ChargeEvidence, stripeHarness } from "./disputes";

// Stripe's sandbox card whose refunds succeed at first and fail a couple of minutes later
export const REFUND_FAILS_CARD = "4000000000005126";

export function stripeRefund(
    action: "show" | "create",
    intentId: string,
    cents?: number,
): Promise<ChargeEvidence> {
    return stripeHarness<ChargeEvidence>([
        "refunds",
        action,
        intentId,
        ...(cents === undefined ? [] : [String(cents)]),
    ]);
}

export interface RefundRecord {
    amount_cents: number;
    status: string;
    credit_note: string | null;
    provider_ref: string | null;
    reason: string | null;
}

export function refundRecords(paymentId: string): Promise<RefundRecord[]> {
    return select<RefundRecord>`
        SELECT amount_cents, status, credit_note, provider_ref, reason FROM payments
        WHERE parent_payment_id = ${paymentId} AND kind = 'refund' ORDER BY created_at, id`;
}
