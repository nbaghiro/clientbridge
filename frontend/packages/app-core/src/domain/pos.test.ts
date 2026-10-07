import { describe, expect, it } from "vitest";

import { allocate, discountCents } from "./billing";
import {
    nextPickupStatus,
    pickupActions,
    pickupOrder,
    previewDiscount,
    priceSale,
    type SaleLine,
    saleTotalLines,
    tipShares,
} from "./pos";

describe("pickupActions", () => {
    it("offers ready or picked up for an order still to prepare", () => {
        expect(pickupActions("unfulfilled").map((a) => a.status)).toEqual(["ready", "picked_up"]);
    });

    it("offers only picked up once ready, and nothing after", () => {
        expect(pickupActions("ready").map((a) => a.status)).toEqual(["picked_up"]);
        expect(pickupActions("picked_up")).toEqual([]);
    });
});

describe("the pickup queue", () => {
    const now = new Date("2026-10-06T16:00:00Z");
    const order = {
        id: "ord_1",
        client_id: "cl_1",
        client_name: null,
        phone: "+12505550201",
        email: "a@x.test",
        pickup_status: "ready" as const,
        total_cents: 4800,
        created_at: "2026-10-03T16:00:00Z",
        ready_at: "2026-10-05T17:00:00Z",
        picked_up_at: null,
    };
    const lines = [
        {
            id: "ln_1",
            order_id: "ord_1",
            item_id: "it_1",
            description: "Brush",
            quantity: 2,
            unit_amount_cents: 2400,
            item_color: null,
        },
        {
            id: "ln_2",
            order_id: "ord_2",
            item_id: "it_2",
            description: "Other",
            quantity: 1,
            unit_amount_cents: 100,
            item_color: null,
        },
    ];

    it("moves an order forward only", () => {
        expect(nextPickupStatus("unfulfilled")).toBe("ready");
        expect(nextPickupStatus("ready")).toBe("picked_up");
        expect(nextPickupStatus("picked_up")).toBeNull();
    });

    it("shapes an order for the board: its lines, contact and how long it has waited", () => {
        const view = pickupOrder(order, lines, now);
        expect(view).toMatchObject({
            clientName: "Guest",
            statusLabel: "Ready",
            intent: "accent",
            itemsLabel: "2 items",
            total: "$48.00",
            contact: "(250) 555-0201 · a@x.test",
            waiting: "Waiting 1 day",
        });
        expect(view.lines.map((l) => l.name)).toEqual(["Brush"]);
        expect(view.when).toMatch(/^Ready since Yesterday/);
    });
});

const RATES = [
    { id: "BC_GST", jurisdiction: "GST", province: "BC", rate_bps: 500, name: "GST 5%" },
    { id: "BC_PST", jurisdiction: "PST", province: "BC", rate_bps: 700, name: "PST (BC) 7%" },
];

function line(
    key: string,
    cents: number,
    taxClass: string,
    extra: Partial<SaleLine> = {},
): SaleLine {
    return {
        key,
        itemId: key,
        kind: "service",
        description: key,
        unitAmountCents: cents,
        quantity: 1,
        taxClass,
        staffId: null,
        bookingId: null,
        color: null,
        imageFileId: null,
        discount: null,
        ...extra,
    };
}

describe("allocate", () => {
    it("splits whole cents by weight, largest remainder first, and always adds up", () => {
        expect(allocate(500, [6750, 2400])).toEqual([369, 131]);
        expect(allocate(1298, [6381, 2269])).toEqual([958, 340]);
        expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
        expect(allocate(0, [5, 5])).toEqual([0, 0]);
        expect(allocate(10, [0, 0])).toEqual([0, 0]);
    });
});

describe("priceSale", () => {
    const groom = line("groom", 7500, "federal_only", {
        staffId: "st_diego",
        discount: { kind: "percent", value: 10, reason: "Loyalty" },
    });
    const shampoo = line("shampoo", 2400, "standard", { kind: "product", staffId: "st_owner" });

    it("takes line discounts, shares the sale discount by value and taxes each line on its net", () => {
        const sale = priceSale(
            [groom, shampoo],
            { kind: "amount", value: 500, reason: "Wait" },
            RATES,
            true,
            { kind: "percent", pct: 15 },
            1875,
        );
        expect(sale.lines.map((l) => l.netCents)).toEqual([6381, 2269]);
        expect(sale.totals.subtotalCents).toBe(8650);
        expect(sale.totals.taxes.map((t) => [t.code, t.cents])).toEqual([
            ["GST", 432],
            ["PST", 159],
        ]);
        expect(sale.totals.tipCents).toBe(1298);
        expect(sale.totals.totalCents).toBe(8650 + 591 + 1298);
        expect(sale.totals.dueCents).toBe(8650 + 591 + 1298 - 1875);
        expect(saleTotalLines(sale.totals).map((r) => r.key)).toEqual([
            "gross",
            "lineDisc",
            "saleDisc",
            "subtotal",
            "GST",
            "PST",
            "tip",
            "total",
            "deposit",
            "due",
        ]);
        expect(
            tipShares(sale.lines, sale.totals.tipCents, "byService", null, []).map((t) => [
                t.staffId,
                t.cents,
            ]),
        ).toEqual([
            ["st_diego", 958],
            ["st_owner", 340],
        ]);
        expect(tipShares(sale.lines, 1298, "one", "st_priya", []).map((t) => t.cents)).toEqual([
            1298,
        ]);
    });

    it("collects no tax for a small supplier and caps an amount discount at the line", () => {
        const sale = priceSale(
            [
                line("a", 1000, "standard", {
                    discount: { kind: "amount", value: 5000, reason: null },
                }),
            ],
            null,
            RATES,
            false,
            { kind: "none" },
        );
        expect([sale.totals.subtotalCents, sale.totals.taxCents]).toEqual([0, 0]);
        expect(discountCents(999, { kind: "percent", value: 50, reason: null })).toBe(500);
    });

    it("previews a discount and flags it over the staff limit", () => {
        const preview = previewDiscount(
            [groom, shampoo],
            null,
            RATES,
            true,
            { scope: "sale", lineKeys: [], discount: { kind: "percent", value: 20, reason: "x" } },
            1500,
        );
        expect(preview.overLimit).toBe(true);
        expect(preview.offCents).toBeGreaterThan(0);
        expect(preview.taxChangeCents).toBeLessThan(0);
        const owner = previewDiscount(
            [groom],
            null,
            RATES,
            true,
            { scope: "lines", lineKeys: ["groom"], discount: null },
            null,
        );
        expect(owner.overLimit).toBe(false);
    });
});
