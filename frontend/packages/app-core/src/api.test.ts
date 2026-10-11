import { describe, expect, it } from "vitest";

import { failedCode, failedStatus, failureMessage, refusal } from "./api";
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
        ];
        for (const [code, message] of cases)
            expect(failureMessage(refused(409, code), "fallback")).toBe(message);
    });

    it("keeps the action's own message for any other failure", () => {
        expect(failureMessage(refused(409, "conflict"), "Couldn't save.")).toBe("Couldn't save.");
        expect(failureMessage(refused(500, null), "Couldn't save.")).toBe("Couldn't save.");
        expect(failureMessage(new TypeError("offline"), "Couldn't save.")).toBe("Couldn't save.");
    });
});
