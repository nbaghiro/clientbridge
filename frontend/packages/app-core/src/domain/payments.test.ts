import { describe, expect, it } from "vitest";

import { strings } from "../strings";
import { cardNoun, payLinkUrl } from "./payments";

describe("cardNoun", () => {
    it("writes Stripe's brand as a name, and a card with none as a card", () => {
        expect(cardNoun("mastercard")).toBe("Mastercard");
        expect(cardNoun(null)).toBe(strings.payments.cardNoun);
    });
});

describe("payLinkUrl", () => {
    it("puts every pay link on the one pay host", () => {
        expect(payLinkUrl("https://pay.clientbridge.ca/", "x7Hq")).toBe(
            "https://pay.clientbridge.ca/i/x7Hq",
        );
    });
});
