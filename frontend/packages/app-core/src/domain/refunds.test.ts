import { describe, expect, it } from "vitest";

import { formatDate } from "../datetime";
import { strings } from "../strings";
import { disputeView, partLabel, refundState } from "./refunds";

const s = strings.refunds;

type PaymentRow = Parameters<typeof refundState>[0];
type DisputeRow = Parameters<typeof disputeView>[0];

const payment = (amount: number, refunded: number): PaymentRow => ({
    id: "pay_1",
    client_name: "Ann",
    kind: "payment",
    method: "card",
    provider: "stripe",
    amount_cents: amount,
    paid_at: "2026-10-01T12:00:00Z",
    created_at: "2026-10-01T12:00:00Z",
    invoice_number: 7,
    order_number: null,
    booking_id: null,
    gift_code: null,
    package_name: null,
    refunded_cents: refunded,
    fee_cents: 175,
});

describe("refunds", () => {
    it("reads paid, partly refunded and refunded from what has gone back", () => {
        expect(refundState(payment(5000, 0))).toBe("paid");
        expect(refundState(payment(5000, -1))).toBe("paid");
        expect(refundState(payment(5000, 1))).toBe("partly_refunded");
        expect(refundState(payment(5000, 4999))).toBe("partly_refunded");
        expect(refundState(payment(5000, 5000))).toBe("refunded");
        expect(refundState(payment(5000, 6000))).toBe("refunded");
    });

    it("names each ledger part a refund reverses", () => {
        expect(partLabel({ category: "tax", code: "GST", cents: 50 })).toBe(s.part_tax("GST"));
        expect(partLabel({ category: "deferred", code: "", cents: 1 })).toBe(s.part_deferred);
        expect(partLabel({ category: "gift_card", code: "", cents: 1 })).toBe(s.part_gift_card);
        expect(partLabel({ category: "deposit", code: "", cents: 1 })).toBe(s.part_deposit);
        expect(partLabel({ category: "revenue", code: "", cents: 1 })).toBe(s.part_revenue);
        expect(partLabel({ category: "anything", code: "", cents: 1 })).toBe(s.part_revenue);
    });
});

describe("disputeView", () => {
    const now = new Date(2026, 9, 7, 12);
    const respondBy = new Date(2026, 9, 10, 18).toISOString();
    const dispute = (extra: Partial<DisputeRow> = {}): DisputeRow => ({
        id: "pay_web",
        client_name: "Ben",
        method: "card",
        amount_cents: 4800,
        paid_at: null,
        created_at: "2026-10-01T12:00:00Z",
        dispute_status: "needs_response",
        dispute_reason: "fraudulent",
        dispute_respond_by: respondBy,
        invoice_number: null,
        order_number: 42,
        gift_code: null,
        package_name: null,
        booking_id: null,
        withdrawn_cents: 0,
        fee_cents: 1500,
        opened_at: null,
        ...extra,
    });

    it("counts the days left to respond and holds the charge plus the fee", () => {
        const view = disputeView(dispute(), now);
        expect(view).toMatchObject({
            open: true,
            subject: s.subject.sale(42),
            statusLabel: s.disputeStatus.needs_response,
            intent: "danger",
            reason: s.disputeReasons.fraudulent,
            deadline: s.respondBy(formatDate(new Date(respondBy)), 3),
        });
        expect(view.held.map((h) => [h.key, h.cents])).toEqual([
            ["withdrawn", 4800],
            ["fee", 1500],
            ["held", 6300],
        ]);
        expect(view.facts.map((f) => f.value)).toEqual([
            s.disputeReasons.fraudulent,
            `${s.method.card ?? ""} · $48.00`,
            s.subject.sale(42),
            "",
        ]);
    });

    it("never counts a passed deadline below zero days", () => {
        const late = disputeView(
            dispute({ dispute_respond_by: new Date(2026, 9, 1, 9).toISOString() }),
            now,
        );
        expect(late.deadline).toBe(s.respondBy(formatDate(new Date(2026, 9, 1, 9)), 0));
    });

    it("uses what the bank withdrew, and closes won and lost disputes", () => {
        const won = disputeView(
            dispute({ dispute_status: "won", withdrawn_cents: 4000, dispute_reason: null }),
            now,
        );
        expect(won).toMatchObject({
            open: false,
            intent: "success",
            deadline: s.wonNote,
            reason: s.disputeReasons.general,
        });
        expect(won.held.map((h) => h.cents)).toEqual([4000, 1500, 5500]);
        expect(disputeView(dispute({ dispute_status: "lost" }), now)).toMatchObject({
            open: false,
            intent: "neutral",
            deadline: s.lostNote,
        });
        expect(disputeView(dispute({ dispute_status: "under_review" }), now)).toMatchObject({
            open: true,
            intent: "warning",
            deadline: s.reviewNote,
        });
    });
});
