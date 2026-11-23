import { describe, expect, it } from "vitest";

import { payCodeMatrix } from "./payCode";
// From Nayuki's qrcodegen: encodeSegments([makeBytes(utf8)], Ecc.MEDIUM, 1, 40, -1, false).
import cases from "./payCode.cases.json" with { type: "json" };

const rows = (m: boolean[][]): string[] =>
    m.map((row) => row.map((on) => (on ? "1" : "0")).join(""));

describe("payCodeMatrix", () => {
    it.each(cases)("encodes $value as the reference version $version symbol", (c) => {
        const m = payCodeMatrix(c.value);
        expect(m).toHaveLength(c.version * 4 + 17);
        expect(rows(m)).toEqual(c.rows);
    });

    it("grows to the smallest version that holds the value", () => {
        expect(payCodeMatrix("https://cb.example/booking")).toHaveLength(25);
        expect(payCodeMatrix("https://cb.example/booking/")).toHaveLength(29);
        expect(payCodeMatrix("https://book.staging.clientbridge.ca/birchbark")).toHaveLength(33);
    });

    it("refuses a value longer than the largest symbol holds", () => {
        expect(() => payCodeMatrix("a".repeat(2332))).toThrow(RangeError);
        expect(payCodeMatrix("a".repeat(2331))).toHaveLength(177);
    });
});
