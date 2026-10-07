import { describe, expect, it } from "vitest";

import {
    blankToNull,
    firstName,
    formatMoney,
    formatMoneyWithCurrency,
    formatPhone,
    initials,
    parseCents,
    phoneDigits,
} from "./format";

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

describe("money", () => {
    it("shows cents as dollars with two decimals and thousands separators", () => {
        expect(formatMoney(0)).toBe("$0.00");
        expect(formatMoney(null)).toBe("$0.00");
        expect(formatMoney(5)).toBe("$0.05");
        expect(formatMoney(1050)).toBe("$10.50");
        expect(formatMoney(123456)).toBe("$1,234.56");
        expect(formatMoney(100000000)).toBe("$1,000,000.00");
    });

    it("puts the minus sign before the dollar sign", () => {
        expect(formatMoney(-2500)).toBe("-$25.00");
        expect(formatMoney(-1)).toBe("-$0.01");
    });

    it("adds the currency code in capitals", () => {
        expect(formatMoneyWithCurrency(1250, "usd")).toBe("$12.50 USD");
        expect(formatMoneyWithCurrency(-99, "CAD")).toBe("-$0.99 CAD");
    });
});

describe("initials and blanks", () => {
    it("takes up to two initials in capitals", () => {
        expect(initials("Amy Lee")).toBe("AL");
        expect(initials("mary jane watson")).toBe("MJ");
        expect(initials("Ann")).toBe("A");
        expect(initials("")).toBe("");
        expect(initials("   ")).toBe("");
        expect(initials("  amy   lee ")).toBe("AL");
        expect(initials(" Ann ")).toBe("A");
        expect(initials("Zoë\tÉlise")).toBe("ZÉ");
    });

    it("trims text and reads a blank as null", () => {
        expect(blankToNull("  Ann ")).toBe("Ann");
        expect(blankToNull("   ")).toBeNull();
        expect(blankToNull("")).toBeNull();
        expect(blankToNull(null)).toBeNull();
        expect(blankToNull(undefined)).toBeNull();
    });
});
