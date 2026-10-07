import { describe, expect, it } from "vitest";

import { strings } from "../strings";
import { paymentErrorMessage } from "./checkout";

describe("paymentErrorMessage", () => {
    it("names the missing Stripe setup when the server answers 503", () => {
        const e = new Error("POST /v1/payments/setup-intent/cl_1 → 503");
        expect(paymentErrorMessage(e, "retry")).toBe(strings.payments.notConfigured);
    });

    it("falls back to the caller's message for any other failure", () => {
        expect(paymentErrorMessage(new Error("POST /v1/x → 500"), "retry")).toBe("retry");
        expect(paymentErrorMessage(new Error("offline"), "retry")).toBe("retry");
        expect(paymentErrorMessage("nope", "retry")).toBe("retry");
    });
});
