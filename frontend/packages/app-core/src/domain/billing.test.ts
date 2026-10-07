import { describe, expect, it } from "vitest";

import { strings } from "../strings";
import {
    type InvoiceRow,
    daysOverdue,
    docDraft,
    docRates,
    invoiceStats,
    invoiceStatus,
    issuedTaxes,
    lineDiscount,
    listRow,
    priceDoc,
} from "./billing";
import { type SavedCardRow, canBeDefault, checkoutMethods } from "./payments";

const BC = [
    { code: "GST", rateBps: 500 },
    { code: "PST", rateBps: 700 },
];

describe("priceDoc", () => {
    it("taxes each line by its class and totals per code, half up", () => {
        const priced = priceDoc(
            [
                { amountCents: 4500, taxClass: "federal_only", included: true },
                { amountCents: 2400, taxClass: "standard", included: true },
                { amountCents: 2900, taxClass: "standard", included: true },
            ],
            BC,
        );
        expect(priced.lines.map((l) => l.codes)).toEqual([["GST"], ["GST", "PST"], ["GST", "PST"]]);
        expect(priced.taxes.map((t) => [t.label, t.baseCents, t.cents])).toEqual([
            ["GST 5%", 9800, 490],
            ["PST 7%", 5300, 371],
        ]);
        expect(priced.totalCents).toBe(10661);
    });

    it("leaves unticked add-ons and exempt lines out of the tax", () => {
        const priced = priceDoc(
            [
                { amountCents: 10000, taxClass: "exempt", included: true },
                { amountCents: 2000, taxClass: "standard", included: false },
            ],
            BC,
        );
        expect(priced.taxes).toEqual([]);
        expect(priced.subtotalCents).toBe(10000);
        expect(priced.lines[1]?.taxCents).toBe(240);
    });

    it("prices QST at its exact rate and collects nothing for a small supplier", () => {
        const qc = docRates(
            [
                { id: "QC_GST", jurisdiction: "GST", province: "QC", rate_bps: 500, name: "GST" },
                { id: "QC_QST", jurisdiction: "QST", province: "QC", rate_bps: 998, name: "QST" },
            ],
            true,
        );
        const priced = priceDoc([{ amountCents: 10000, taxClass: "standard", included: true }], qc);
        expect(priced.taxes.map((t) => [t.label, t.cents])).toEqual([
            ["GST 5%", 500],
            ["QST 9.975%", 998],
        ]);
        expect(docRates(null, true)).toEqual([]);
        expect(
            docRates(
                [{ id: "x", jurisdiction: "GST", province: "AB", rate_bps: 500, name: "GST" }],
                false,
            ),
        ).toEqual([]);
    });
});

const method = {
    client_id: "cl",
    brand: null,
    last4: null,
    preferred: 0,
    mandate_status: "none",
    status: "active",
};

describe("chargeable saved methods", () => {
    it("offers cards and active bank mandates, never an Interac contact", () => {
        const cards: SavedCardRow[] = [
            { ...method, id: "card", method: "card", brand: "visa", last4: "4242" },
            { ...method, id: "bank", method: "bank_eft", mandate_status: "active" },
            { ...method, id: "pending", method: "bank_eft", mandate_status: "pending" },
            { ...method, id: "interac", method: "interac" },
        ];
        expect(checkoutMethods(cards).map((m) => m.id)).toEqual(["card", "bank"]);
        expect(cards.filter(canBeDefault).map((c) => c.id)).toEqual(["card", "bank"]);
        const [card] = cards;
        expect(card !== undefined && canBeDefault({ ...card, preferred: 1 })).toBe(false);
    });
});

type LineRow = Parameters<typeof lineDiscount>[0];

const docLine = (extra: Partial<LineRow> = {}): LineRow => ({
    id: "ln_1",
    item_id: "it_1",
    booking_id: null,
    description: "Groom",
    quantity: 2,
    unit_amount_cents: 2400,
    amount_cents: 4800,
    tax_amount_cents: 0,
    tax_class: "standard",
    optional: null,
    selected: null,
    position: 0,
    ...extra,
});

describe("draft documents", () => {
    it("reads a line's stored discount, ignoring a zero or unknown one", () => {
        expect(lineDiscount(docLine({ discount_kind: "percent", discount_value: 10 }))).toEqual({
            kind: "percent",
            value: 10,
            reason: null,
        });
        expect(
            lineDiscount(
                docLine({
                    discount_kind: "amount",
                    discount_value: 500,
                    discount_reason: "Regular",
                }),
            ),
        ).toEqual({ kind: "amount", value: 500, reason: "Regular" });
        expect(lineDiscount(docLine({ discount_kind: "amount", discount_value: 0 }))).toBeNull();
        expect(lineDiscount(docLine({ discount_kind: "free", discount_value: 5 }))).toBeNull();
        expect(lineDiscount(docLine())).toBeNull();
    });

    it("opens a draft for editing with typed-in quantities and dollars", () => {
        const draft = docDraft(invoice({ notes: null, number: null }), [
            docLine({ discount_kind: "percent", discount_value: 10 }),
            docLine({
                id: "ln_2",
                item_id: null,
                description: "Nail trim",
                quantity: 1.5,
                unit_amount_cents: 1005,
                tax_class: "federal_only",
                optional: 1,
            }),
            docLine({ id: "ln_3", tax_class: "zero_rated", unit_amount_cents: 0 }),
        ]);
        expect(draft).toMatchObject({ id: "inv_1", number: null, clientId: "cl_1", notes: "" });
        expect(draft.lines).toEqual([
            {
                description: "Groom",
                quantity: "2",
                unit: "24.00",
                itemId: "it_1",
                taxClass: "standard",
                optional: false,
                discount: { kind: "percent", value: 10, reason: null },
            },
            {
                description: "Nail trim",
                quantity: "1.5",
                unit: "10.05",
                itemId: null,
                taxClass: "federal_only",
                optional: true,
                discount: null,
            },
            {
                description: "Groom",
                quantity: "2",
                unit: "0.00",
                itemId: "it_1",
                taxClass: "standard",
                optional: false,
                discount: null,
            },
        ]);
    });

    it("prints the tax the ledger booked, labelled from the computed rates", () => {
        const pricing = priceDoc(
            [{ amountCents: 10000, taxClass: "standard", included: true }],
            BC,
        );
        expect(issuedTaxes(pricing, [])).toEqual(pricing.taxes);
        expect(
            issuedTaxes(pricing, [
                { code: "GST", cents: 501 },
                { code: "PST", cents: 0 },
                { code: "HST", cents: 1300 },
            ]),
        ).toEqual([
            { code: "GST", label: "GST 5%", baseCents: 10000, cents: 501 },
            { code: "HST", label: "HST", baseCents: 0, cents: 1300 },
        ]);
    });
});

function invoice(extra: Partial<InvoiceRow> = {}): InvoiceRow {
    return {
        id: "inv_1",
        client_id: "cl_1",
        client_name: "Ann",
        client_email: null,
        client_phone: null,
        number: 7,
        status: "sent",
        subtotal_cents: 5000,
        tax_total_cents: 0,
        total_cents: 5000,
        balance_cents: 5000,
        paid_cents: 0,
        issued_at: null,
        due_at: null,
        paid_at: null,
        voided_at: null,
        pay_token: null,
        notes: "Thanks",
        created_at: "2026-09-01T12:00:00Z",
        ...extra,
    };
}

describe("invoice status and stats", () => {
    const now = new Date(2026, 9, 7, 12);
    const due = (days: number): string => new Date(2026, 9, 7 + days, 9).toISOString();

    it("counts whole days past due only while a balance is owed on a sent invoice", () => {
        expect(daysOverdue(invoice({ due_at: due(-6) }), now)).toBe(6);
        expect(daysOverdue(invoice({ due_at: due(-1) }), now)).toBe(1);
        expect(daysOverdue(invoice({ due_at: due(0) }), now)).toBe(0);
        expect(daysOverdue(invoice({ due_at: due(3) }), now)).toBe(0);
        expect(daysOverdue(invoice({ due_at: null }), now)).toBe(0);
        expect(daysOverdue(invoice({ due_at: due(-6), balance_cents: 0 }), now)).toBe(0);
        expect(daysOverdue(invoice({ due_at: due(-6), balance_cents: null }), now)).toBe(0);
        expect(daysOverdue(invoice({ due_at: due(-6), status: "partial" }), now)).toBe(6);
        expect(daysOverdue(invoice({ due_at: due(-6), status: "draft" }), now)).toBe(0);
        expect(daysOverdue(invoice({ due_at: due(-6), status: "paid" }), now)).toBe(0);
    });

    it("turns a sent invoice overdue the day after it was due", () => {
        expect(invoiceStatus(invoice({ due_at: due(0) }), now)).toBe("sent");
        expect(invoiceStatus(invoice({ due_at: due(-1) }), now)).toBe("overdue");
        expect(invoiceStatus(invoice({ due_at: due(-1), status: "partial" }), now)).toBe("partial");
        expect(invoiceStatus(invoice({ status: "refunded" }), now)).toBe("refunded");
        expect(invoiceStatus(invoice({ status: "mystery" }), now)).toBe("sent");
        const row = listRow(invoice({ due_at: due(-2) }), now);
        expect(row).toMatchObject({
            status: "overdue",
            statusLabel: strings.billing.statusLabel.overdue,
            intent: "danger",
            number: strings.billing.number(7),
            dueLabel: strings.billing.overdueBy(2),
            late: true,
        });
    });

    it("totals what is outstanding, overdue, paid in the last 30 days and still in draft", () => {
        const daysAgo = (n: number): string => new Date(2026, 9, 7 - n, 12).toISOString();
        const rows = [
            invoice({ id: "late", due_at: due(-3), balance_cents: 5000 }),
            invoice({ id: "part", status: "partial", balance_cents: 3000, paid_cents: 2000 }),
            invoice({ id: "draft", status: "draft", total_cents: 7000, balance_cents: 7000 }),
            invoice({
                id: "paid",
                status: "paid",
                balance_cents: 0,
                paid_cents: 10000,
                paid_at: daysAgo(5),
            }),
            invoice({
                id: "old",
                status: "paid",
                balance_cents: 0,
                paid_cents: 9999,
                paid_at: daysAgo(40),
            }),
            invoice({ id: "void", status: "void", balance_cents: 0 }),
        ].map((r) => listRow(r, now));
        expect(invoiceStats(rows, now)).toEqual({
            outstandingCents: 8000,
            outstandingCount: 2,
            overdueCents: 5000,
            overdueCount: 1,
            paid30Cents: 10000,
            paid30Count: 1,
            draftCents: 7000,
            draftCount: 1,
        });
        expect(invoiceStats([], now).outstandingCents).toBe(0);
    });
});
