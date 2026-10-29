// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { strings } from "../strings";
import { createPublicPaymentSetupClient, paymentErrorMessage, useCheckout } from "./checkout";

describe("createPublicPaymentSetupClient", () => {
    it("sends the payer email only in the Stripe setup start request", async () => {
        const fetch = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ status: "requires_payment_method" }), {
                status: 200,
            }),
        );
        vi.stubGlobal("fetch", fetch);
        try {
            const client = createPublicPaymentSetupClient("https://connect.example");
            await client.start("setup-token", "payer@example.test");
            expect(fetch).toHaveBeenCalledWith(
                "https://connect.example/payment-method/start",
                expect.objectContaining({
                    method: "POST",
                    headers: {
                        "X-Payment-Setup-Token": "setup-token",
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ email: "payer@example.test" }),
                }),
            );
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe("paymentErrorMessage", () => {
    it("names the missing Stripe setup when the server answers 503", () => {
        const e = Object.assign(new Error("refused"), {
            status: 503,
            code: "payments_not_configured",
        });
        expect(paymentErrorMessage(e, "retry")).toBe(strings.payments.notConfigured);
    });

    it("names a declined card from the server's code", () => {
        const declined = Object.assign(new Error("402"), { status: 402, code: "card_declined" });
        expect(paymentErrorMessage(declined, "retry")).toBe(strings.api.cardDeclined);
    });

    it("falls back to the caller's message for any other failure", () => {
        const failed = Object.assign(new Error("refused"), { status: 500, code: null });
        expect(paymentErrorMessage(failed, "retry")).toBe("retry");
        expect(paymentErrorMessage(new Error("offline"), "retry")).toBe("retry");
        expect(paymentErrorMessage("nope", "retry")).toBe("retry");
    });
});

describe("useCheckout", () => {
    const refused = (status: number | undefined) =>
        Object.assign(new Error("refused"), status === undefined ? {} : { status, code: null });

    it("starts a new attempt after a refusal and keeps the key when the answer was lost", async () => {
        const keys: string[] = [];
        const failures = [refused(402), refused(409), refused(undefined)];
        const charge = (input: { idempotencyKey: string }) => {
            keys.push(input.idempotencyKey);
            return Promise.reject(failures[keys.length - 1] ?? new Error("done"));
        };
        const { result } = renderHook(() =>
            useCheckout(() => undefined, { defaultMethod: "pm_1" }),
        );
        for (let press = 1; press <= 3; press++) {
            act(() => {
                result.current.pay(charge, "retry", { amount: 500 });
            });
            await waitFor(() => {
                expect(keys).toHaveLength(press);
            });
            await waitFor(() => {
                expect(result.current.busy).toBe(false);
            });
        }
        // a declined card is asked again under a new key; a conflict or lost answer keeps it
        expect(keys[1]).not.toBe(keys[0]);
        expect(keys[2]).toBe(keys[1]);
    });
});
