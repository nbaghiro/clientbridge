import { describe, expect, it } from "vitest";

import { formatList } from "../format";
import { strings } from "../strings";
import {
    type PublicReceipt,
    type VisitReceipt,
    printedVisitReceipt,
    publicReceiptTotals,
} from "./publicReceipt";

const r = strings.publicReceipt;

function receipt(extra: Partial<PublicReceipt> = {}): PublicReceipt {
    return {
        number: 42,
        business_name: "Birch Studio",
        brand: { logo_url: null, primary: null, tagline: null },
        timezone: "America/Vancouver",
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
            { kind: "deposit", method: null, amount_cents: 2750, tip_cents: 0, at: null },
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
                label: "GST 5%",
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

function visit(extra: Partial<VisitReceipt> = {}): VisitReceipt {
    return {
        ...receipt(),
        address: {
            unit: null,
            street_number: "1250",
            street_name: "Main St",
            city: "Victoria",
            province: "BC",
            postal_code: "V8W 1A1",
        },
        phone: "+12505550142",
        source: "invoice",
        service: "Massage, 60 min",
        visit_at: "2026-10-07T16:00:00Z",
        practitioner: "Amy Chen",
        practitioner_title: "RMT · Reg. 12345",
        served_by: ["Amy Chen"],
        ...extra,
    };
}

describe("printedVisitReceipt", () => {
    const p = strings.printing;

    it("prints the invoice number, the practitioner and the business address", () => {
        const doc = printedVisitReceipt(visit(), "#000");
        expect([doc.kind, doc.number]).toEqual(["receipt", "42"]);
        expect(doc.meta).toEqual([
            { label: p.forInvoice, value: "42" },
            { label: p.practitioner, value: "Amy Chen · RMT · Reg. 12345" },
            { label: p.serviceDate, value: "October 7, 2026" },
            { label: p.service, value: "Massage, 60 min" },
        ]);
        expect(doc.business.address).toEqual(["1250 Main St", "Victoria, BC, V8W 1A1"]);
        expect(doc.business.phone).toBe("(250) 555-0142");
        expect(doc.headline.cents).toBe(2750 + 11791 - 2000 + 1);
        expect(doc.stamp).toBe(p.paidStamp);
    });

    it("names the rest of the crew after the practitioner", () => {
        const doc = printedVisitReceipt(
            visit({ served_by: ["Amy Chen", "Priya Shah", "Diego Ruiz"] }),
            "#000",
        );
        expect(doc.meta[2]).toEqual({
            label: p.assistedBy,
            value: formatList(["Priya Shah", "Diego Ruiz"], "unit"),
        });
        expect(printedVisitReceipt(visit({ served_by: ["Amy Chen"] }), "#000").meta).toHaveLength(
            4,
        );
    });

    it("numbers a desk sale's receipt as the sale and leaves out a missing practitioner", () => {
        const doc = printedVisitReceipt(
            visit({ source: "sale", practitioner: null, practitioner_title: null, status: "open" }),
            "#000",
        );
        expect(doc.number).toBe("S-42");
        expect(doc.meta[0]).toEqual({ label: p.forSale, value: "S-42" });
        expect(doc.meta[1]?.value).toBe("");
        expect(doc.stamp).toBeNull();
    });
});
