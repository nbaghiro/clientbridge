import { describe, expect, it } from "vitest";

import { bookingPageUrl, setupTasks } from "./business";

type Counts = Parameters<typeof setupTasks>[0];

const fresh: Counts = {
    services: 0,
    hours: 0,
    team: 1,
    stripe: 0,
    slug: "birch",
    name: "Birchbark",
    brand: null,
    province: "BC",
    tax_registered: 0,
    pst_number: null,
    dismissed_at: null,
    classes: 0,
    invites: null,
};

describe("setupTasks", () => {
    it("starts a new business with only the business step done", () => {
        const tasks = setupTasks(fresh);
        expect(tasks.map((t) => t.key)).toEqual([
            "business",
            "services",
            "hours",
            "brand",
            "stripe",
            "team",
            "tax",
        ]);
        expect(tasks.filter((t) => t.done).map((t) => t.key)).toEqual(["business"]);
        expect(tasks[0]?.hint).toBe("Birchbark, British Columbia");
    });

    it("marks each step done from the synced counts", () => {
        const tasks = setupTasks({
            ...fresh,
            services: 3,
            classes: 1,
            hours: 5,
            team: 2,
            stripe: 1,
            brand: JSON.stringify({ primary: "#2E4A3F" }),
            tax_registered: 1,
            pst_number: "PST-1234-5678",
            invites: "amy@birch.test, ben@birch.test",
        });
        expect(tasks.every((t) => t.done)).toBe(true);
        expect(tasks.find((t) => t.key === "services")?.hint).toBe("2 services and 1 class");
        expect(tasks.find((t) => t.key === "team")?.hint).toBe("2 invites waiting");
    });

    it("counts a logo alone as a brand", () => {
        const tasks = setupTasks({ ...fresh, brand: JSON.stringify({ logo_file_id: "fl_1" }) });
        expect(tasks.find((t) => t.key === "brand")?.done).toBe(true);
    });
});

describe("bookingPageUrl", () => {
    it("joins the Connect host and the slug without a doubled slash", () => {
        expect(bookingPageUrl("https://book.example.ca/", "birch")).toBe(
            "https://book.example.ca/book/birch",
        );
    });
});
