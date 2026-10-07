import { describe, expect, it } from "vitest";

import { firstName, formatPhone, parseCents, phoneDigits } from "./format";

describe("parseCents", () => {
    it("reads typed dollars as cents", () => {
        expect(parseCents("$1,250.50")).toBe(125050);
        expect(parseCents("75")).toBe(7500);
        expect(parseCents("0.1")).toBe(10);
    });

    it("rejects blanks, negatives and words", () => {
        expect(parseCents("")).toBeNull();
        expect(parseCents("  ")).toBeNull();
        expect(parseCents("-5")).toBeNull();
        expect(parseCents("ten")).toBeNull();
    });
});

describe("phone numbers", () => {
    it("drops the country code from a North American number", () => {
        expect(phoneDigits("+1 (250) 555-0201")).toBe("2505550201");
        expect(phoneDigits("250.555.0201")).toBe("2505550201");
    });

    it("formats ten digits and leaves anything else as entered", () => {
        expect(formatPhone("+12505550201")).toBe("(250) 555-0201");
        expect(formatPhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
        expect(formatPhone(null)).toBe("");
    });
});

describe("firstName", () => {
    it("takes the first word", () => {
        expect(firstName("Hannah Wong")).toBe("Hannah");
        expect(firstName("  Diego ")).toBe("Diego");
    });
});
