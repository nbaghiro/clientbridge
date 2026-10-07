import { describe, expect, it } from "vitest";

import { creditNoteNumber, payLinkUrl } from "./payments";

describe("creditNoteNumber", () => {
    it("numbers a credit note after the invoice or sale it credits", () => {
        expect(creditNoteNumber(1143, 1)).toBe("CN-1143-1");
        expect(creditNoteNumber("S-1044", 2)).toBe("CN-S-1044-2");
    });
});

describe("payLinkUrl", () => {
    it("puts every pay link on the one pay host", () => {
        expect(payLinkUrl("https://pay.clientbridge.ca/", "x7Hq")).toBe(
            "https://pay.clientbridge.ca/i/x7Hq",
        );
    });
});
