import { describe, expect, it } from "vitest";

import { strings } from "../strings";
import { type PublicReceipt, publicReceiptTotals } from "./publicReceipt";

const r = strings.publicReceipt;

function receipt(extra: Partial<PublicReceipt> = {}): PublicReceipt {
    return {
        number: 42,
        business_name: "Birch Studio",
        brand: { logo_url: null, primary: null, tagline: null },
        gst_hst_number: null,
        qst_number: null,
        client_name: "Ann",
        served_by: ["Amy"],
        status: "paid",
        currency: "CAD",
        created_at: "2026-10-07T16:00:00Z",
        lines: [],
        discount_cents: 2380,
        discount_reason: "Loyalty",
        subtotal_cents: 12420,
        taxes: [{ code: "GST", rate_bps: 500, base_cents: 12420, cents: 621 }],
        tax_total_cents: 621,
        total_cents: 13041,
        tip_cents: 1500,
        payments: [
            { kind: "deposit", method: "card", amount_cents: 2750, tip_cents: 0, at: null },
            { kind: "payment", method: "card", amount_cents: 11791, tip_cents: 1500, at: null },
            { kind: "refund", method: "card", amount_cents: 2000, tip_cents: 0, at: null },
            { kind: "payment", method: "barter", amount_cents: 1, tip_cents: 0, at: null },
        ],
        ...extra,
    };
}

describe("publicReceiptTotals", () => {
    it("shows the discount, tax, an untaxed tip in the total, and refunds as negative", () => {
        expect(publicReceiptTotals(receipt())).toEqual([
            { key: "discount", label: r.discount, cents: 2380, kind: "credit", hint: "Loyalty" },
            { key: "subtotal", label: r.subtotal, cents: 12420, kind: "subtotal" },
            {
                key: "GST",
                label: strings.billing.taxRow("GST", "5%"),
                cents: 621,
                kind: "tax",
            },
            { key: "tip", label: r.tip, cents: 1500, kind: "subtotal", hint: r.tipNoTax },
            { key: "total", label: r.total, cents: 14541, kind: "total" },
            { key: "pay-0", label: r.deposit, cents: 2750, kind: "credit" },
            { key: "pay-1", label: r.method.card, cents: 11791, kind: "credit" },
            { key: "pay-2", label: r.refund, cents: -2000, kind: "credit" },
            { key: "pay-3", label: r.method.other, cents: 1, kind: "credit" },
        ]);
    });

    it("leaves out a zero discount and a zero tip", () => {
        const totals = publicReceiptTotals(
            receipt({ discount_cents: 0, tip_cents: 0, taxes: [], payments: [] }),
        );
        expect(totals.map((t) => [t.key, t.cents])).toEqual([
            ["subtotal", 12420],
            ["total", 13041],
        ]);
        expect(totals[0]?.hint).toBeUndefined();
    });
});
