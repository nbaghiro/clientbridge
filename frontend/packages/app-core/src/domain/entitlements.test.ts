import { describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { formatDate, parseTimestamp } from "../datetime";
import { strings } from "../strings";

import { packageBalance } from "./clients";
import {
    type PackageRow,
    canConsume,
    consumeSession,
    giftDefault,
    giftPresets,
    nextSessionCents,
    sessionsRemaining,
    subscriptionTiming,
} from "./entitlements";

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

it("earns each session from what was paid, not the current price, and the last takes the rest", () => {
    expect(nextSessionCents(6001, 6001, 2, 0)).toBe(3000);
    expect(nextSessionCents(6001, 3001, 2, 1)).toBe(3001);
    expect(nextSessionCents(6001, 1000, 3, 0)).toBe(1000);
    expect(nextSessionCents(0, 0, 1, 0)).toBe(0);
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

describe("gift card presets", () => {
    it("offers the chosen gift card item's suggested amounts", () => {
        expect(giftPresets({ gift_amounts: "{2500,15000}" })).toEqual(["25", "150"]);
        expect(giftPresets({ gift_amounts: "[15000,20000]" })).toEqual(["150", "200"]);
    });

    it("falls back to the defaults without an item or its suggestions", () => {
        expect(giftPresets({ gift_amounts: null })).toEqual(["25", "50", "75", "100"]);
        expect(giftPresets(null)).toEqual(["25", "50", "75", "100"]);
    });

    it("starts a sale at $50 when it is offered, else at the first suggestion", () => {
        expect(giftDefault(["25", "50", "75"])).toBe("50");
        expect(giftDefault(["150", "200"])).toBe("150");
        expect(giftDefault([])).toBe("50");
    });
});

describe("subscriptionTiming", () => {
    const zone = "America/Vancouver";
    const end = "2026-11-13T08:00:00Z";
    const date = formatDate(parseTimestamp(end), zone);
    const sub = (status: string, periodEnd: string | null = end) => ({
        id: "su_1",
        client_id: "cl_ann",
        item_id: "it_plan",
        item_name: "Monthly Plan",
        status,
        current_period_end: periodEnd,
        payment_method_id: null,
    });

    it("says when a billing membership charges next and when a canceled one ended", () => {
        expect(subscriptionTiming(sub("active"), zone)).toBe(strings.clients.nextCharge(date));
        expect(subscriptionTiming(sub("past_due"), zone)).toBe(strings.clients.nextCharge(date));
        expect(subscriptionTiming(sub("canceled"), zone)).toBe(
            strings.clients.subscriptionEnded(date),
        );
    });

    it("says nothing for a membership not yet billing or without a period", () => {
        expect(subscriptionTiming(sub("incomplete"), zone)).toBeNull();
        expect(subscriptionTiming(sub("active", null), zone)).toBeNull();
    });
});
