import { describe, expect, it } from "vitest";

import {
    type ItemFormValues,
    type ItemRow,
    entitlementKindsOnSale,
    filterCatalog,
    itemFormError,
    itemPayload,
    sellableItems,
    stockState,
} from "./catalog";

const base: ItemRow = {
    id: "it_1",
    kind: "product",
    name: "Shampoo",
    description: null,
    category: null,
    price_cents: 2400,
    currency: "CAD",
    duration_min: null,
    capacity: null,
    active: 1,
    color: null,
    image_file_id: null,
    online_bookable: 0,
    buffer_before_min: 0,
    buffer_after_min: 0,
    deposit_type: "none",
    deposit_value: null,
    session_count: null,
    validity_days: null,
    interval: null,
    frequency: null,
    tax_class: "standard",
    sku: null,
    cost_cents: null,
    track_stock: 1,
    sell_online: 0,
    stock_on_hand: 5,
    low_stock_at: 2,
};

const values: ItemFormValues = {
    kind: "service",
    name: "Groom",
    description: "",
    category: "",
    price: "75",
    duration: "60",
    bufferBefore: "0",
    bufferAfter: "10",
    capacity: "",
    onlineBookable: true,
    depositType: "percent",
    depositValue: "25",
    sessionCount: "",
    validityDays: "",
    interval: "1",
    frequency: "month",
    taxClass: "federal_only",
    sku: "SKU-1",
    cost: "",
    trackStock: false,
    openingStock: "",
    lowStockAt: "",
    sellOnline: false,
};

describe("stock", () => {
    it("reads in stock, low and out from the count and threshold", () => {
        expect(stockState(base)).toBe("in");
        expect(stockState({ ...base, stock_on_hand: 2 })).toBe("low");
        expect(stockState({ ...base, stock_on_hand: 0 })).toBe("out");
        expect(stockState({ ...base, track_stock: 0 })).toBe("untracked");
    });

    it("filters low stock and archived items", () => {
        const rows = [
            base,
            { ...base, id: "low", stock_on_hand: 1 },
            { ...base, id: "old", active: 0 },
        ];
        expect(filterCatalog(rows, "lowStock").map((r) => r.id)).toEqual(["low"]);
        expect(filterCatalog(rows, "archived").map((r) => r.id)).toEqual(["old"]);
        expect(filterCatalog(rows, "all").map((r) => r.id)).toEqual(["it_1", "low"]);
    });
});

describe("what a sale can carry", () => {
    it("keeps entitlements out of sale lines and offers them as their own tiles", () => {
        const rows = [
            base,
            { ...base, id: "gc", kind: "gift" },
            { ...base, id: "pk", kind: "package" },
        ];
        expect(sellableItems(rows).map((r) => r.id)).toEqual(["it_1"]);
        expect(entitlementKindsOnSale(rows)).toEqual(["gift", "package"]);
    });
});

describe("item editor", () => {
    it("sends only the fields a service uses, with a percent deposit as a number", () => {
        const body = itemPayload(values, true);
        expect(body).toMatchObject({
            kind: "service",
            price_cents: 7500,
            duration_min: 60,
            buffer_after_min: 10,
            deposit_type: "percent",
            deposit_value: 25,
            tax_class: "federal_only",
            online_bookable: true,
        });
        expect(body).not.toHaveProperty("sku");
        expect(body).not.toHaveProperty("session_count");
    });

    it("sends a fixed deposit in cents and leaves the kind out on edit", () => {
        const body = itemPayload({ ...values, depositType: "fixed", depositValue: "20" }, false);
        expect(body.deposit_value).toBe(2000);
        expect(body).not.toHaveProperty("kind");
    });

    it("checks the fields each kind needs", () => {
        expect(itemFormError(values)).toBeNull();
        expect(itemFormError({ ...values, duration: "" })).not.toBeNull();
        expect(itemFormError({ ...values, depositValue: "120" })).not.toBeNull();
        expect(itemFormError({ ...values, kind: "package", sessionCount: "" })).not.toBeNull();
        expect(
            itemFormError({ ...values, kind: "product", trackStock: true, openingStock: "-1" }),
        ).not.toBeNull();
    });
});
