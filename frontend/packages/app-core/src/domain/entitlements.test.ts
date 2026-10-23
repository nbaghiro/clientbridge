import { describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";

import { packageBalance } from "./clients";
import { type PackageRow, canConsume, consumeSession, sessionsRemaining } from "./entitlements";

const pkg = (total: number, used: number, status = "active"): PackageRow => ({
    id: "pk_1",
    client_id: "cl_ann",
    item_id: "it_pkg",
    item_name: "Five Cuts",
    subject_name: null,
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

    it("leads a package's balance with the student it belongs to", () => {
        expect(packageBalance("Maya", "6 of 10 left")).toBe("Maya: 6 of 10 left");
        expect(packageBalance(null, "6 of 10 left")).toBe("6 of 10 left");
    });

    it("draws a session only from an active package with one left", () => {
        expect(canConsume(pkg(5, 4))).toBe(true);
        expect(canConsume(pkg(5, 5))).toBe(false);
        expect(canConsume(pkg(5, 0, "expired"))).toBe(false);
        expect(canConsume(pkg(5, 0, "pending"))).toBe(false);
    });
});

it("passes a stable attempt key when consuming a package session", async () => {
    const post = vi.fn().mockResolvedValue(pkg(5, 1));
    const api: ApiLike = { get: vi.fn(), getText: vi.fn(), post, patch: vi.fn(), delete: vi.fn() };
    await consumeSession(api, "pk_1", "consume-attempt");
    await consumeSession(api, "pk_1", "consume-attempt");
    expect(post).toHaveBeenNthCalledWith(
        1,
        "/v1/packages/pk_1/consume",
        {},
        { idempotencyKey: "consume-attempt" },
    );
    expect(post).toHaveBeenNthCalledWith(
        2,
        "/v1/packages/pk_1/consume",
        {},
        { idempotencyKey: "consume-attempt" },
    );
});
