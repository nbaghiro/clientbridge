import { describe, expect, it } from "vitest";

import { strings } from "../strings";

import {
    type ItemFormValues,
    type ItemRow,
    giftAmounts,
    groupByCategory,
    itemFormError,
    itemMeta,
    itemPayload,
    itemPriceLabel,
    itemStatus,
    matchesFilter,
    sellableItems,
    stockScale,
    stockState,
    taxOptions,
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
    covers_item_id: null,
    visits_per_period: null,
    member_discount_bps: null,
    gift_amounts: null,
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
    coversItemId: "",
    visitsPerPeriod: "",
    memberDiscount: "",
    giftAmounts: [],
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
        const ids = (f: Parameters<typeof matchesFilter>[1]): string[] =>
            rows.filter((r) => matchesFilter(r, f)).map((r) => r.id);
        expect(ids("lowStock")).toEqual(["low"]);
        expect(ids("archived")).toEqual(["old"]);
        expect(ids("all")).toEqual(["it_1", "low"]);
        expect(ids("products")).toEqual(["it_1", "low"]);
        expect(ids("services")).toEqual([]);
    });

    it("scales the meter so the low line sits at the middle", () => {
        expect(stockScale(5, 2)).toBe(4);
        expect(stockScale(0, null)).toBe(2);
    });
});

describe("catalog list", () => {
    it("groups by category in kind order, an item without one under its kind", () => {
        const rows = [
            { ...base, id: "pk", kind: "package", category: null },
            { ...base, id: "p", category: "Retail" },
            { ...base, id: "sv", kind: "service", category: "Grooming" },
        ];
        expect(groupByCategory(rows).map((g) => g.title)).toEqual([
            "Grooming",
            "Retail",
            "Packages",
        ]);
    });

    it("describes each kind in one line", () => {
        expect(
            itemMeta({
                ...base,
                kind: "service",
                duration_min: 60,
                buffer_after_min: 15,
                deposit_type: "percent",
                deposit_value: 25,
            }),
        ).toBe("60 min · 15 min buffer · 25% deposit");
        expect(itemMeta({ ...base, kind: "package", session_count: 5, validity_days: 365 })).toBe(
            "5 visits · valid 12 months",
        );
        expect(itemMeta({ ...base, sku: "BB-1" })).toBe("SKU BB-1");
    });

    it("reads suggested gift amounts from the replica's array text", () => {
        expect(giftAmounts({ gift_amounts: "[5000,10000]" })).toEqual([5000, 10000]);
        expect(giftAmounts({ gift_amounts: "{2500}" })).toEqual([2500]);
        expect(giftAmounts({ gift_amounts: null })).toEqual([]);
    });

    it("names the tax classes after the taxes the business charges", () => {
        const bc = [
            { id: "BC_GST", jurisdiction: "GST", province: "BC", rate_bps: 500, name: "GST 5%" },
            { id: "BC_PST", jurisdiction: "PST", province: "BC", rate_bps: 700, name: "PST 7%" },
        ];
        expect(taxOptions(bc).map((o) => o.label)).toEqual(["GST only", "GST and PST", "No tax"]);
        expect(taxOptions(null)[1]?.label).toBe("All sales taxes");
    });
});

describe("what a sale can carry", () => {
    it("keeps entitlements out of sale lines", () => {
        const rows = [
            base,
            { ...base, id: "gc", kind: "gift" },
            { ...base, id: "pk", kind: "package" },
        ];
        expect(sellableItems(rows).map((r) => r.id)).toEqual(["it_1"]);
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

    it("sends plan details for the kinds that carry them", () => {
        const pkg = itemPayload(
            { ...values, kind: "package", sessionCount: "5", coversItemId: "it_bath" },
            true,
        );
        expect(pkg).toMatchObject({ session_count: 5, covers_item_id: "it_bath" });
        const club = itemPayload(
            { ...values, kind: "subscription", visitsPerPeriod: "2", memberDiscount: "10" },
            false,
        );
        expect(club).toMatchObject({ visits_per_period: 2, member_discount_bps: 1000 });
        expect(itemPayload({ ...values, kind: "gift", giftAmounts: [5000] }, true)).toMatchObject({
            gift_amounts: [5000],
        });
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
            itemFormError({ ...values, kind: "package", sessionCount: "3", coversItemId: "" }),
        ).toBe("Choose which service a visit covers");
        expect(
            itemFormError({ ...values, kind: "subscription", memberDiscount: "120" }),
        ).not.toBeNull();
        expect(
            itemFormError({ ...values, kind: "product", trackStock: true, openingStock: "-1" }),
        ).not.toBeNull();
    });
});

describe("item price and status", () => {
    const c = strings.catalog;

    it("prices an item, a plan per period and a gift card at any amount", () => {
        expect(itemPriceLabel({ ...base, kind: "service", price_cents: 7500 })).toBe("$75.00");
        expect(itemPriceLabel({ ...base, price_cents: null })).toBe("$0.00");
        expect(
            itemPriceLabel({ ...base, kind: "subscription", price_cents: 5000, frequency: "week" }),
        ).toBe(c.perPeriod("$50.00", c.freqLabel.week ?? ""));
        expect(
            itemPriceLabel({ ...base, kind: "subscription", price_cents: 5000, frequency: null }),
        ).toBe(c.perPeriod("$50.00", c.freqLabel.month ?? ""));
        expect(itemPriceLabel({ ...base, kind: "gift", price_cents: 2500 })).toBe(c.anyAmount);
    });

    it("pills an archived item first, then low or out of stock, else nothing", () => {
        expect(itemStatus({ ...base, active: 0, stock_on_hand: 0 })).toEqual({
            label: c.archived,
            intent: "neutral",
        });
        expect(itemStatus({ ...base, stock_on_hand: 2 })).toEqual({
            label: c.stockLow(2),
            intent: "warning",
        });
        expect(itemStatus({ ...base, stock_on_hand: 0 })).toEqual({
            label: c.stockOut,
            intent: "danger",
        });
        expect(itemStatus({ ...base, stock_on_hand: -3 })?.label).toBe(c.stockOut);
        expect(itemStatus({ ...base, stock_on_hand: 3 })).toBeNull();
        expect(itemStatus({ ...base, track_stock: 0, stock_on_hand: 0 })).toBeNull();
        expect(itemStatus({ ...base, low_stock_at: null, stock_on_hand: 1 })).toBeNull();
    });
});
