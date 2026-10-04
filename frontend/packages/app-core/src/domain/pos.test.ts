import { describe, expect, it } from "vitest";

import { pickupActions } from "./pos";

describe("pickupActions", () => {
    it("offers ready or picked up for an order still to prepare", () => {
        expect(pickupActions("unfulfilled").map((a) => a.status)).toEqual(["ready", "picked_up"]);
    });

    it("offers only picked up once ready, and nothing after", () => {
        expect(pickupActions("ready").map((a) => a.status)).toEqual(["picked_up"]);
        expect(pickupActions("picked_up")).toEqual([]);
    });
});
