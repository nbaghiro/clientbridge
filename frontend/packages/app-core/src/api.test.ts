import { describe, expect, it } from "vitest";

import {
    type Attempt,
    attemptKey,
    failedCode,
    failedDetail,
    failedStatus,
    failureMessage,
    refusal,
    sendAttempt,
} from "./api";
import { strings } from "./strings";

const refused = (status: number, code: string | null): Error =>
    Object.assign(new Error(`POST /v1/x → ${String(status)}`), { status, code });

describe("refused requests", () => {
    it("reads the status and code a refusal carries, and nothing from other errors", () => {
        expect(failedStatus(refused(422, "invalid_timezone"))).toBe(422);
        expect(failedCode(refused(422, "invalid_timezone"))).toBe("invalid_timezone");
        expect(failedStatus(new TypeError("Failed to fetch"))).toBeNull();
        expect(failedCode(new Error("boom"))).toBeNull();
    });

    it("reads a public response's status and code, never its English message", async () => {
        const res = new Response(
            JSON.stringify({ error: "out_of_stock", message: "only 2 left" }),
            {
                status: 409,
            },
        );
        const e = await refusal(res);
        expect(e).toMatchObject({ status: 409, code: "out_of_stock" });
        expect(failureMessage(e, "fallback")).toBe(strings.api.outOfStock);
        expect(await refusal(new Response("<html>", { status: 502 }))).toMatchObject({
            status: 502,
            code: null,
        });
    });

    it("maps each code the server names to its catalog message", () => {
        const cases: [string, string][] = [
            ["invalid_timezone", strings.api.invalidTimezone],
            ["out_of_stock", strings.api.outOfStock],
            ["pickup_window_taken", strings.api.pickupWindowTaken],
            ["shop_not_ready", strings.api.shopNotReady],
            ["mixed_currencies", strings.api.mixedCurrencies],
            ["slot_unavailable", strings.api.slotUnavailable],
            ["class_seat", strings.api.classSeat],
            ["class_move", strings.api.classMove],
            ["recurrence_too_long", strings.api.recurrenceTooLong],
            ["idempotency_key_reused", strings.api.idempotencyKeyReused],
            ["visit_not_started", strings.api.visitNotStarted],
            ["estimate_booked", strings.api.estimateBooked],
            ["estimate_on_visit", strings.api.estimateOnVisit],
            ["deposit_not_due", strings.api.depositNotDue],
            ["deposit_in_progress", strings.api.depositInProgress],
            ["card_payments_unavailable", strings.api.cardPaymentsUnavailable],
        ];
        for (const [code, message] of cases)
            expect(failureMessage(refused(409, code), "fallback")).toBe(message);
    });

    it("reads the values a refusal names, such as how many visits hold an add-on's length", async () => {
        const res = Response.json(
            { error: "addon_length_in_use", message: "in use", detail: { count: 3 } },
            { status: 409 },
        );
        const e = await refusal(res);
        expect(failedDetail(e)).toEqual({ count: 3 });
        expect(failureMessage(e, "fallback")).toBe(strings.api.addonLengthInUse(3));
        expect(failedDetail(refused(409, "conflict"))).toEqual({});
        expect(failedDetail(Object.assign(new Error("x"), { detail: [1] }))).toEqual({});
    });

    it("keeps the action's own message for any other failure", () => {
        expect(failureMessage(refused(409, "conflict"), "Couldn't save.")).toBe("Couldn't save.");
        expect(failureMessage(refused(500, null), "Couldn't save.")).toBe("Couldn't save.");
        expect(failureMessage(new TypeError("offline"), "Couldn't save.")).toBe("Couldn't save.");
    });
});

describe("write attempts", () => {
    it("keeps one key across retries of the same request and renews it when the request changes", () => {
        const ref: { current: Attempt | null } = { current: null };
        const first = attemptKey(ref, { starts_at: "10:00", note: "" });
        expect(attemptKey(ref, { starts_at: "10:00", note: "" })).toBe(first);
        const changed = attemptKey(ref, { starts_at: "11:00", note: "" });
        expect(changed).not.toBe(first);
        ref.current = null;
        expect(attemptKey(ref, { starts_at: "11:00", note: "" })).not.toBe(changed);
    });

    it("retries once with a fresh key when the server holds the key for other details", async () => {
        const ref: { current: Attempt | null } = { current: null };
        const stale = attemptKey(ref, "old choice");
        ref.current = { key: stale, request: JSON.stringify("new choice") };
        const sent: string[] = [];
        const out = await sendAttempt(ref, "new choice", (key) => {
            sent.push(key);
            return sent.length === 1
                ? Promise.reject(refused(422, "idempotency_key_reused"))
                : Promise.resolve("booked");
        });
        expect(out).toBe("booked");
        expect(sent).toHaveLength(2);
        expect(sent[0]).toBe(stale);
        expect(sent[1]).not.toBe(stale);
        expect(ref.current.key).toBe(sent[1]);
    });

    it("does not retry any other failure, nor a second refusal of a fresh key", async () => {
        const ref: { current: Attempt | null } = { current: null };
        let calls = 0;
        await expect(
            sendAttempt(ref, "choice", () => {
                calls += 1;
                return Promise.reject(refused(409, "slot_unavailable"));
            }),
        ).rejects.toMatchObject({ code: "slot_unavailable" });
        expect(calls).toBe(1);
        calls = 0;
        await expect(
            sendAttempt(ref, "choice", () => {
                calls += 1;
                return Promise.reject(refused(422, "idempotency_key_reused"));
            }),
        ).rejects.toMatchObject({ code: "idempotency_key_reused" });
        expect(calls).toBe(2);
    });
});
