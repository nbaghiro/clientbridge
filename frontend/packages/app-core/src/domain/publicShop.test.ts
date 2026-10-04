import { describe, expect, it } from "vitest";

import { cartSubtotal } from "./publicShop";

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
