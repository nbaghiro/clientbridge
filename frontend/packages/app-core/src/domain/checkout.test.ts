import { describe, expect, it, vi } from "vitest";

import { strings } from "../strings";
import { createPublicPaymentSetupClient, paymentErrorMessage } from "./checkout";

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

    it("falls back to the caller's message for any other failure", () => {
        const failed = Object.assign(new Error("refused"), { status: 500, code: null });
        expect(paymentErrorMessage(failed, "retry")).toBe("retry");
        expect(paymentErrorMessage(new Error("offline"), "retry")).toBe("retry");
        expect(paymentErrorMessage("nope", "retry")).toBe("retry");
    });
});
