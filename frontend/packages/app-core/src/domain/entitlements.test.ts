import { describe, expect, it } from "vitest";

import { type PackageRow, canConsume, sessionsRemaining } from "./entitlements";

const pkg = (total: number, used: number, status = "active"): PackageRow => ({
    id: "pk_1",
    client_id: "cl_ann",
    item_id: "it_pkg",
    item_name: "Five Cuts",
    sessions_total: total,
    sessions_used: used,
    status,
});

describe("packages", () => {
    it("counts sessions left, never below zero", () => {
        expect(sessionsRemaining(pkg(5, 2))).toBe(3);
        expect(sessionsRemaining(pkg(5, 5))).toBe(0);
        expect(sessionsRemaining(pkg(5, 7))).toBe(0);
        expect(sessionsRemaining(pkg(0, 0))).toBe(0);
    });

    it("draws a session only from an active package with one left", () => {
        expect(canConsume(pkg(5, 4))).toBe(true);
        expect(canConsume(pkg(5, 5))).toBe(false);
        expect(canConsume(pkg(5, 0, "expired"))).toBe(false);
        expect(canConsume(pkg(5, 0, "pending"))).toBe(false);
    });
});
