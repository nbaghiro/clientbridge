import { describe, expect, it } from "vitest";

import { strings } from "../strings";
import { cartSubtotal, productCount, shopTotalLines } from "./publicShop";

const items = [
    { id: "it_a", price_cents: 1500 },
    { id: "it_b", price_cents: 899 },
];

describe("cartSubtotal", () => {
    it("multiplies each price by its cart quantity", () => {
        expect(cartSubtotal(items, { it_a: 2, it_b: 1 })).toBe(3899);
    });

    it("ignores items not in the cart and cart ids no longer listed", () => {
        expect(cartSubtotal(items, { it_b: 3, it_gone: 4 })).toBe(2697);
        expect(cartSubtotal(items, {})).toBe(0);
    });
});

describe("productCount", () => {
    const catalog = [
        { id: "it_travel" },
        { id: "it_travel_100", variant_parent_id: "it_travel" },
        { id: "it_travel_250", variant_parent_id: "it_travel" },
        { id: "it_brush", variant_parent_id: null },
    ];

    it("adds a product's variants to its own quantity", () => {
        expect(productCount(catalog, { it_travel_100: 2, it_travel_250: 1 }, "it_travel")).toBe(3);
    });

    it("counts a plain product alone and ignores other products", () => {
        expect(productCount(catalog, { it_brush: 2, it_travel_100: 4 }, "it_brush")).toBe(2);
        expect(productCount(catalog, {}, "it_brush")).toBe(0);
    });
});

describe("shopTotalLines", () => {
    it("shows the cart subtotal as an estimate before the order exists", () => {
        expect(shopTotalLines(3899, null)).toEqual([
            {
                key: "total",
                label: strings.publicShop.estimatedTotal,
                cents: 3899,
                kind: "total",
            },
        ]);
    });

    it("uses the server's subtotal, tax and total once the order is placed", () => {
        const lines = shopTotalLines(3899, {
            subtotal_cents: 3800,
            tax_total_cents: 190,
            total_cents: 3990,
        });
        expect(lines.map((line) => [line.kind, line.cents])).toEqual([
            ["subtotal", 3800],
            ["tax", 190],
            ["total", 3990],
        ]);
    });

    it("falls back to the cart subtotal and leaves out tax the server did not report", () => {
        const lines = shopTotalLines(1500, { total_cents: 1500 });
        expect(lines.map((line) => [line.kind, line.cents])).toEqual([
            ["subtotal", 1500],
            ["total", 1500],
        ]);
    });
});
