import { afterEach, describe, expect, it } from "vitest";

import { setPseudoLocale } from "../locale";
import { strings } from "../strings";
import { shortDate } from "./printing";
import {
    printedPublicInvoice,
    publicDocLines,
    publicDocTaxes,
    publicInvoiceTotals,
} from "./publicPay";

const ZONE = "America/Vancouver";

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
        timezone: ZONE,
        subtotal_cents: 10000,
        tax_total_cents: 1498,
        total_cents: 11498,
        balance_cents: 3748,
        status: "partial",
        accepts_card: true,
        contact_phone: null,
        contact_email: null,
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
            {
                kind: "payment",
                method: "etransfer",
                amount_cents: 5000,
                at: "2026-10-03T12:00:00Z",
            },
        ],
        ...extra,
    };
}

describe("the public pay page", () => {
    it("labels each tax with its rate, QST at its exact 9.975%", () => {
        expect(publicDocTaxes(TAXES)).toEqual([
            {
                code: "GST",
                label: "GST 5%",
                baseCents: 10000,
                cents: 500,
            },
            {
                code: "QST",
                label: "QST 9.975%",
                baseCents: 10000,
                cents: 998,
            },
            {
                code: "PST",
                label: "PST 7.5%",
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
            pp.credit(pp.method.etransfer, shortDate("2026-10-03T12:00:00Z", ZONE)),
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
        expect(totals[3]?.label).toBe(pp.credit(pp.method.other, ""));
        expect(
            publicInvoiceTotals(publicInvoice({ discount_cents: 0 })).map((t) => t.key),
        ).not.toContain("discount");
    });

    it("prints the invoice in the record's currency and the business zone", () => {
        const doc = printedPublicInvoice(
            publicInvoice({
                number: 1002,
                currency: "USD",
                issued_at: "2026-10-02T05:30:00Z",
                gst_hst_number: "84720 1539 RT0001",
                qst_number: "1234567890 TQ0001",
                address: { street_number: "1250", street_name: "Main St", city: "Victoria" },
                phone: "+12505550142",
            }),
            "https://pay.test/i/x",
            "#000",
        );
        expect([doc.title, doc.reference, doc.heading, doc.currency]).toEqual([
            "Invoice",
            "#1002",
            "Invoice #1002",
            "USD",
        ]);
        expect(doc.meta[1]?.value).toBe("October 1, 2026");
        expect(doc.labels.page).toBe("Page 1 of 1");
        expect(doc.labels.taxBase("$10.00")).toBe("On $10.00");
        expect(doc.business.registration).toBe("GST/HST 84720 1539 RT0001 · QST 1234567890 TQ0001");
        expect([doc.business.address, doc.business.phone]).toEqual([
            ["1250 Main St", "Victoria"],
            "(250) 555-0142",
        ]);
        const draft = printedPublicInvoice(publicInvoice({ number: null }), "u", "#000");
        expect([draft.reference, draft.heading]).toEqual(["Draft", "Invoice Draft"]);
    });

    it("prints how to pay online only when the business takes cards", () => {
        const online = printedPublicInvoice(publicInvoice(), "https://pay.test/i/x", "#000");
        expect([online.payUrl, online.instructions]).toEqual([
            "https://pay.test/i/x",
            [strings.printing.payOnline("https://pay.test/i/x")],
        ]);
        const offline = printedPublicInvoice(
            publicInvoice({ accepts_card: false, contact_email: "hi@birch.test" }),
            "https://pay.test/i/x",
            "#000",
        );
        expect([offline.payUrl, offline.instructions, offline.business.email]).toEqual([
            null,
            [],
            "hi@birch.test",
        ]);
    });
});

describe("printed documents in the pseudo-locale", () => {
    afterEach(async () => {
        await setPseudoLocale(false);
    });

    it("leaves no unconverted text", async () => {
        await setPseudoLocale(true);
        const doc = printedPublicInvoice(
            publicInvoice({ number: 1002, contact_email: "pay@x.test", gst_hst_number: "1" }),
            "https://pay.test/i/x",
            "#000",
        );
        const l = doc.labels;
        const copy = [
            doc.title,
            doc.reference,
            doc.heading,
            doc.deadline,
            doc.partyLabel,
            doc.footer,
            doc.business.registration,
            ...doc.meta.map((m) => m.label),
            doc.meta[0]?.value ?? "",
            ...doc.instructions,
            ...doc.totals.map((t) => t.label),
            doc.headline.label,
            ...[l.from, l.item, l.qty, l.price, l.tax, l.amount, l.taxSummary, l.howToPay],
            ...[l.scanToPay, l.paymentMethod, l.page, l.taxBase("1"), l.forSubject("Rex")],
            l.qtyTimes(2, "3"),
        ];
        expect(copy.filter((text) => /[A-Za-z]/.test(text) && !text.startsWith("["))).toEqual([]);
    });
});
