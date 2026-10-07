import { describe, expect, it } from "vitest";

import { createActionsFor } from "./navigation";
import { highlight, searchHits } from "./search";

const data = {
    clients: [
        {
            id: "cl_1",
            name: "Marcus Bennett",
            email: "marcus@x.test",
            phone: "+12505550202",
            status: "active",
        },
        { id: "cl_2", name: "Olivia Martin", email: null, phone: null, status: "archived" },
    ],
    bookings: [
        {
            id: "bk_1",
            starts_at: "2026-10-06T18:00:00Z",
            item_name: "Full Groom",
            item_color: "#123456",
            client_name: "Marcus Bennett",
            staff_name: "Diego Ramirez",
            staff_title: null,
            staff_role: "staff",
        },
    ],
    invoices: [
        {
            id: "inv_1",
            number: 1146,
            status: "overdue",
            total_cents: 4725,
            client_name: "Ethan Wright",
        },
    ],
    items: [
        {
            id: "it_1",
            kind: "product",
            name: "Slicker Brush",
            category: "Brushes",
            sku: "BR-1",
            duration_min: null,
            price_cents: 1800,
            color: null,
        },
    ],
    actions: createActionsFor("owner"),
};
const now = new Date("2026-10-06T16:00:00Z");

describe("searchHits", () => {
    it("finds clients by name, email or any phone format, with book and message for the top one", () => {
        const hits = searchHits("mar", data, now);
        expect(hits.clients.map((h) => h.id)).toEqual(["cl_1", "cl_2"]);
        expect(hits.clients[1]?.meta).toBe("archived");
        expect(hits.actions.map((h) => h.id)).toEqual(["book-cl_1", "msg-cl_1"]);
        expect(searchHits("250-555-0202", data, now).clients.map((h) => h.id)).toEqual(["cl_1"]);
    });

    it("finds bookings by client, service or staff, and invoices by number", () => {
        expect(searchHits("diego", data, now).bookings[0]).toMatchObject({
            id: "bk_1",
            refId: "bk_1",
            target: "booking",
        });
        expect(searchHits("#1146", data, now).invoices[0]).toMatchObject({
            title: "#1146",
            metaIntent: "danger",
        });
        expect(searchHits("br-1", data, now).items[0]).toMatchObject({
            id: "it_1",
            meta: "$18.00",
        });
    });

    it("offers to add a client when a name matches nothing, and staff get no invoice action", () => {
        const none = searchHits("zed", data, now);
        expect(none.actions.map((a) => a.id)).toEqual(["add-client"]);
        expect(searchHits("1146", data, now).actions).toEqual([]);
        expect(createActionsFor("staff").map((a) => a.key)).not.toContain("invoice");
    });
});

describe("highlight", () => {
    it("splits around the first match, ignoring case and a leading #", () => {
        expect(highlight("Marcus Bennett", "BEN")).toEqual([
            { text: "Marcus ", match: false },
            { text: "Ben", match: true },
            { text: "nett", match: false },
        ]);
        expect(highlight("#1146", "#11")).toEqual([
            { text: "#", match: false },
            { text: "11", match: true },
            { text: "46", match: false },
        ]);
        expect(highlight("Bella", "")).toEqual([{ text: "Bella", match: false }]);
    });
});
