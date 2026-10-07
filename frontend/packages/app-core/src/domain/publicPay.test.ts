import { describe, expect, it } from "vitest";

import { strings } from "../strings";
import { shortDate } from "./printing";
import { publicDocLines, publicDocTaxes, publicInvoiceTotals } from "./publicPay";

type PublicInvoice = Parameters<typeof publicInvoiceTotals>[0];

const pp = strings.publicPay;

const TAXES = [
    { code: "GST", rate_bps: 500, base_cents: 10000, cents: 500 },
    { code: "QST", rate_bps: 998, base_cents: 10000, cents: 998 },
    { code: "PST", rate_bps: 750, base_cents: 2000, cents: 150 },
];

function publicInvoice(extra: Partial<PublicInvoice> = {}): PublicInvoice {
    return {
        number: 7,
        business_name: "Birch Studio",
        brand: { logo_url: null, primary: null, tagline: null },
        currency: "CAD",
        subtotal_cents: 10000,
        tax_total_cents: 1498,
        total_cents: 11498,
        balance_cents: 3748,
        status: "partial",
        accepts_card: true,
        interac_email: null,
        client_name: "Ann",
        issued_at: null,
        due_at: null,
        notes: null,
        gst_hst_number: null,
        qst_number: null,
        lines: [],
        taxes: TAXES.slice(0, 2),
        credits: [
            { kind: "deposit", method: "card", amount_cents: 2750, at: "2026-10-01T12:00:00Z" },
            { kind: "payment", method: "interac", amount_cents: 5000, at: "2026-10-03T12:00:00Z" },
        ],
        ...extra,
    };
}

describe("the public pay page", () => {
    it("labels each tax with its rate, QST at its exact 9.975%", () => {
        expect(publicDocTaxes(TAXES)).toEqual([
            {
                code: "GST",
                label: strings.billing.taxRow("GST", "5%"),
                baseCents: 10000,
                cents: 500,
            },
            {
                code: "QST",
                label: strings.billing.taxRow("QST", "9.975%"),
                baseCents: 10000,
                cents: 998,
            },
            {
                code: "PST",
                label: strings.billing.taxRow("PST", "7.5%"),
                baseCents: 2000,
                cents: 150,
            },
        ]);
        expect(publicDocTaxes([])).toEqual([]);
    });

    it("numbers printed lines by position and keeps their tax codes", () => {
        expect(
            publicDocLines([
                {
                    description: "Groom",
                    quantity: 1,
                    unit_amount_cents: 7500,
                    amount_cents: 7500,
                    tax_codes: ["GST"],
                },
                {
                    description: "Shampoo",
                    quantity: 2,
                    unit_amount_cents: 1250,
                    amount_cents: 2500,
                    tax_codes: [],
                },
            ]),
        ).toEqual([
            {
                id: "0",
                description: "Groom",
                subject: null,
                quantity: 1,
                unitCents: 7500,
                amountCents: 7500,
                taxCodes: ["GST"],
            },
            {
                id: "1",
                description: "Shampoo",
                subject: null,
                quantity: 2,
                unitCents: 1250,
                amountCents: 2500,
                taxCodes: [],
            },
        ]);
    });

    it("lists subtotal, tax per code, total, each credit and the balance", () => {
        const totals = publicInvoiceTotals(publicInvoice());
        expect(totals.map((t) => [t.key, t.kind, t.cents])).toEqual([
            ["subtotal", "subtotal", 10000],
            ["GST", "tax", 500],
            ["QST", "tax", 998],
            ["total", "total", 11498],
            ["credit-0", "credit", 2750],
            ["credit-1", "credit", 5000],
            ["balance", "balance", 3748],
        ]);
        expect(totals[4]?.label).toBe(pp.depositCredit);
        expect(totals[5]?.label).toBe(
            pp.credit(pp.method.interac ?? "", shortDate("2026-10-03T12:00:00Z")),
        );
    });

    it("leads with the discount when there is one and names an unknown method as other", () => {
        const totals = publicInvoiceTotals(
            publicInvoice({
                discount_cents: 1000,
                discount_reason: "Loyalty",
                taxes: [],
                credits: [{ kind: "payment", method: null, amount_cents: 100, at: null }],
            }),
        );
        expect(totals[0]).toEqual({
            key: "discount",
            label: strings.publicReceipt.discount,
            cents: 1000,
            kind: "credit",
            hint: "Loyalty",
        });
        expect(totals.map((t) => t.key)).toEqual([
            "discount",
            "subtotal",
            "total",
            "credit-0",
            "balance",
        ]);
        expect(totals[3]?.label).toBe(pp.credit(pp.method.other ?? "", ""));
        expect(
            publicInvoiceTotals(publicInvoice({ discount_cents: 0 })).map((t) => t.key),
        ).not.toContain("discount");
    });
});
