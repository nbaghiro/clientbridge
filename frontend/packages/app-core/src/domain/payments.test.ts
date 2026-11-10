import { describe, expect, it } from "vitest";

import { payLinkUrl } from "./payments";

describe("payLinkUrl", () => {
    it("puts every pay link on the one pay host", () => {
        expect(payLinkUrl("https://pay.clientbridge.ca/", "x7Hq")).toBe(
            "https://pay.clientbridge.ca/i/x7Hq",
        );
    });
});
