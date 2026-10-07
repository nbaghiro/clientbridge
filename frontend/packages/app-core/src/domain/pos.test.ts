import { describe, expect, it } from "vitest";

import { nextPickupStatus, pickupActions, pickupOrder } from "./pos";

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
