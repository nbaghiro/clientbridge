import { describe, expect, it } from "vitest";

import { strings } from "../strings";
import { paymentErrorMessage } from "./checkout";

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
