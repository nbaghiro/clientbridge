import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    blankToNull,
    currencyAffix,
    firstName,
    formatAmountInput,
    formatCredit,
    formatList,
    formatMoney,
    formatMoneyShort,
    formatMoneyWithCurrency,
    formatNumber,
    formatPercent,
    formatPhone,
    normalizePhone,
    formatRate,
    formatRating,
    initials,
    parseCents,
    parseNumber,
    phoneDigits,
} from "./format";
import { setPseudoLocale } from "./locale";
import { strings } from "./strings";

const locale = vi.hoisted(() => ({ tag: null as string | null }));

vi.mock("./locale", async (importOriginal) => {
    const real = await importOriginal<typeof import("./locale")>();
    return { ...real, activeLocale: () => locale.tag ?? real.activeLocale() };
});

afterEach(async () => {
    locale.tag = null;
    await setPseudoLocale(false);
});

describe("parseCents", () => {
    it("reads typed dollars as cents", () => {
        expect(parseCents("$1,250.50", "CAD")).toBe(125050);
        expect(parseCents("75", "CAD")).toBe(7500);
        expect(parseCents("0.1", "CAD")).toBe(10);
        expect(parseCents("US$12.50", "USD")).toBe(1250);
        expect(parseCents("12.50 USD", "USD")).toBe(1250);
    });

    it("rejects blanks, negatives and words", () => {
        expect(parseCents("", "CAD")).toBeNull();
        expect(parseCents("  ", "CAD")).toBeNull();
        expect(parseCents("-5", "CAD")).toBeNull();
        expect(parseCents("ten", "CAD")).toBeNull();
        expect(parseCents("1.2.3", "CAD")).toBeNull();
    });

    it("reads the separators and sign of a locale with a decimal comma", () => {
        locale.tag = "fr-CA";
        expect(parseCents("1 250,50 $", "CAD")).toBe(125050);
        expect(parseCents("1\u202f250,5", "CAD")).toBe(125050);
        locale.tag = "de-DE";
        expect(parseCents("1.250,50 €", "EUR")).toBe(125050);
        expect(parseNumber("12,5")).toBe(12.5);
    });
});

describe("parseNumber", () => {
    it("reads grouping and decimal separators of the active locale", () => {
        expect(parseNumber("1,234.5")).toBe(1234.5);
        expect(parseNumber(" 42 ")).toBe(42);
        expect(parseNumber("-3")).toBe(-3);
        expect(parseNumber("")).toBeNull();
        expect(parseNumber("4 kg")).toBeNull();
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

    it("stores numbers as E.164 by the server's rule", () => {
        expect(normalizePhone("(250) 555-0101")).toBe("+12505550101");
        expect(normalizePhone("1 250 555 0101")).toBe("+12505550101");
        expect(normalizePhone("+1 250-555-0101")).toBe("+12505550101");
        expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
        expect(normalizePhone("555-0101")).toBeNull();
        expect(normalizePhone("0250 555 0101")).toBeNull();
        expect(normalizePhone("+0 123 4567")).toBeNull();
        expect(normalizePhone("")).toBeNull();
    });
});

describe("firstName", () => {
    it("takes the first word", () => {
        expect(firstName("Hannah Wong")).toBe("Hannah");
        expect(firstName("  Diego ")).toBe("Diego");
    });
});

describe("money", () => {
    it("shows cents in the amount's currency with two decimals and thousands separators", () => {
        expect(formatMoney(0, "CAD")).toBe("$0.00");
        expect(formatMoney(null, "CAD")).toBe("$0.00");
        expect(formatMoney(5, "CAD")).toBe("$0.05");
        expect(formatMoney(1050, "CAD")).toBe("$10.50");
        expect(formatMoney(123456, "CAD")).toBe("$1,234.56");
        expect(formatMoney(100000000, "CAD")).toBe("$1,000,000.00");
        expect(formatMoney(1250, "USD")).toBe("US$12.50");
        expect(formatMoney(1250, "eur")).toBe("€12.50");
        expect(formatMoney(1250, "JPY")).toBe("JP¥1,250");
        expect(parseCents("¥1,250", "JPY")).toBe(1250);
    });

    it("puts the minus sign before the currency sign", () => {
        expect(formatMoney(-2500, "CAD")).toBe("-$25.00");
        expect(formatMoney(-1, "CAD")).toBe("-$0.01");
        expect(formatCredit(2500, "CAD")).toBe("\u2212$25.00");
        expect(formatCredit(-2500, "CAD")).toBe("\u2212$25.00");
        expect(formatCredit(0, "CAD")).toBe("$0.00");
    });

    it("adds the currency code in capitals", () => {
        expect(formatMoneyWithCurrency(1250, "usd")).toBe("$12.50 USD");
        expect(formatMoneyWithCurrency(-99, "CAD")).toBe("-$0.99 CAD");
    });

    it("writes an amount for a field and puts the sign where the locale does", () => {
        expect(formatAmountInput(125050, "CAD")).toBe("1250.50");
        expect(formatAmountInput(1250, "JPY")).toBe("1250");
        expect(currencyAffix("CAD")).toEqual({ prefix: "$" });
        locale.tag = "fr-CA";
        expect(formatAmountInput(125050, "CAD")).toBe("1250,50");
        expect(currencyAffix("CAD")).toEqual({ suffix: "$" });
    });

    it("formats in the pseudo-locale too", async () => {
        await setPseudoLocale(true);
        expect(formatMoney(123456, "CAD")).toBe("CA$1,234.56");
        expect(formatMoneyWithCurrency(1250, "CAD")).toBe("$12.50 CAD");
    });
});

describe("numbers and rates", () => {
    it("formats ratings, rates and shares", () => {
        expect(formatRating(4.66)).toBe("4.7");
        expect(formatRating(5)).toBe("5.0");
        expect(formatRate(500)).toBe("5%");
        expect(formatRate(997.5)).toBe("9.975%");
        expect(formatRate(1250)).toBe("12.5%");
        expect(formatPercent(0.676)).toBe("67.6%");
        expect(formatNumber(1234.5)).toBe("1,234.5");
        locale.tag = "fr-CA";
        expect(formatRate(997.5)).toBe("9,975\u00a0%");
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

describe.each([
    {
        tag: "en-CA",
        money: ["$1,234.56", "US$12.50", "JP¥1,250", "-$25.00", "\u2212$25.00", "$30,000"],
        list: "Bath, Nails and Teeth",
        stars: ["1 star", "4 stars"],
    },
    {
        tag: "en-XA",
        money: ["CA$1,234.56", "$12.50", "¥1,250", "-CA$25.00", "\u2212CA$25.00", "CA$30,000"],
        list: "Bath, Nails, and Teeth",
        stars: ["[1 šţåŕ one two]", "[4 šţåŕš one two]"],
    },
])("the formatter in $tag", ({ tag, money, list, stars }) => {
    beforeEach(async () => {
        await setPseudoLocale(tag === "en-XA");
    });

    it("formats money in several currencies, negative amounts and credits", () => {
        expect([
            formatMoney(123456, "CAD"),
            formatMoney(1250, "USD"),
            formatMoney(1250, "JPY"),
            formatMoney(-2500, "CAD"),
            formatCredit(2500, "CAD"),
            formatMoneyShort(3_000_000, "CAD"),
        ]).toEqual(money);
    });

    it("formats percentages, numbers and lists", () => {
        expect(formatPercent(0.676)).toBe("67.6%");
        expect(formatRate(997.5)).toBe("9.975%");
        expect(formatNumber(1234.5)).toBe("1,234.5");
        expect(formatList(["Bath", "Nails", "Teeth"])).toBe(list);
    });

    it("chooses the plural form through the catalog", () => {
        expect([strings.common.stars(1), strings.common.stars(4)]).toEqual(stars);
    });
});
