import { describe, expect, it } from "vitest";

import { docRates, priceDoc } from "./billing";
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
