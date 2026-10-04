import { describe, expect, it } from "vitest";

import { docTotals } from "./billing";
import { type SavedCardRow, canBeDefault, checkoutMethods } from "./payments";

const doc = { subtotal_cents: 10000, tax_total_cents: 1200, total_cents: 11200 };

describe("docTotals", () => {
    it("splits tax by code when the ledger breakdown matches the stored total", () => {
        const rows = docTotals(doc, [
            { code: "GST", cents: 500 },
            { code: "PST", cents: 700 },
        ]);
        expect(rows.map((r) => [r.label, r.cents])).toEqual([
            ["Subtotal", 10000],
            ["GST", 500],
            ["PST", 700],
            ["Total", 11200],
        ]);
    });

    it("falls back to one tax row without a matching breakdown", () => {
        expect(docTotals(doc, []).map((r) => r.label)).toEqual(["Subtotal", "Tax", "Total"]);
        expect(docTotals(doc, [{ code: "GST", cents: 500 }]).map((r) => r.label)).toEqual([
            "Subtotal",
            "Tax",
            "Total",
        ]);
    });

    it("omits the tax row when nothing is taxed", () => {
        const untaxed = { subtotal_cents: 5000, tax_total_cents: 0, total_cents: 5000 };
        expect(docTotals(untaxed, []).map((r) => r.label)).toEqual(["Subtotal", "Total"]);
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
