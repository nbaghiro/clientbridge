import { describe, expect, it } from "vitest";

import { filingPeriod, taxExample, taxSummary } from "./taxes";

describe("taxSummary", () => {
    it("names each province's taxes and keeps only GST or HST for federal-only items", () => {
        expect(taxSummary("BC")).toBe("GST 5% + PST 7%");
        expect(taxSummary("BC", "federal_only")).toBe("GST 5%");
        expect(taxSummary("SK")).toBe("GST 5% + PST 6%");
        expect(taxSummary("ON")).toBe("HST 13%");
        expect(taxSummary("ON", "federal_only")).toBe("HST 13%");
        expect(taxSummary("NS")).toBe("HST 14%");
        expect(taxSummary("AB")).toBe("GST 5%");
        expect(taxSummary(null)).toBe("GST 5%");
        expect(taxSummary("ZZ")).toBe("GST 5%");
    });
});

describe("taxExample", () => {
    it("works the tax on $100 per class, half cents rounded", () => {
        expect(taxExample("standard", "BC", true)).toEqual({
            lines: [
                { label: "GST 5%", cents: 500 },
                { label: "PST 7%", cents: 700 },
            ],
            totalCents: 11200,
        });
        expect(taxExample("federal_only", "BC", true)).toEqual({
            lines: [{ label: "GST 5%", cents: 500 }],
            totalCents: 10500,
        });
        expect(taxExample("standard", "ON", true, 999)).toEqual({
            lines: [{ label: "HST 13%", cents: 130 }],
            totalCents: 1129,
        });
        expect(taxExample("standard", "BC", true, 999).lines.map((l) => l.cents)).toEqual([50, 70]);
        expect(taxExample("standard", "NS", true, 1001).totalCents).toBe(1141);
    });

    it("collects nothing on exempt items or for a small supplier", () => {
        expect(taxExample("exempt", "BC", true)).toEqual({ lines: [], totalCents: 10000 });
        expect(taxExample("standard", "BC", false)).toEqual({ lines: [], totalCents: 10000 });
        expect(taxExample("standard", "BC", true, 0)).toEqual({
            lines: [
                { label: "GST 5%", cents: 0 },
                { label: "PST 7%", cents: 0 },
            ],
            totalCents: 0,
        });
    });
});

describe("filingPeriod", () => {
    const d = (y: number, m: number, day: number, h = 12) => new Date(y, m - 1, day, h);

    it("finds the quarter holding today, due a month after it ends", () => {
        expect(filingPeriod("quarterly", d(2026, 2, 15))).toEqual({
            from: d(2026, 1, 1, 0),
            to: d(2026, 3, 31, 0),
            due: d(2026, 4, 30, 0),
        });
        expect(filingPeriod("quarterly", d(2026, 3, 31, 23))).toMatchObject({
            from: d(2026, 1, 1, 0),
        });
        expect(filingPeriod("quarterly", d(2026, 4, 1, 0))).toEqual({
            from: d(2026, 4, 1, 0),
            to: d(2026, 6, 30, 0),
            due: d(2026, 7, 31, 0),
        });
        expect(filingPeriod("quarterly", d(2026, 11, 15))).toEqual({
            from: d(2026, 10, 1, 0),
            to: d(2026, 12, 31, 0),
            due: d(2027, 1, 31, 0),
        });
    });

    it("handles monthly periods, February included, and the calendar year", () => {
        expect(filingPeriod("monthly", d(2026, 12, 10))).toEqual({
            from: d(2026, 12, 1, 0),
            to: d(2026, 12, 31, 0),
            due: d(2027, 1, 31, 0),
        });
        expect(filingPeriod("monthly", d(2028, 2, 29))).toEqual({
            from: d(2028, 2, 1, 0),
            to: d(2028, 2, 29, 0),
            due: d(2028, 3, 31, 0),
        });
        expect(filingPeriod("monthly", d(2026, 1, 20)).due).toEqual(d(2026, 2, 28, 0));
        expect(filingPeriod("annual", d(2026, 7, 1))).toEqual({
            from: d(2026, 1, 1, 0),
            to: d(2026, 12, 31, 0),
            due: d(2027, 4, 30, 0),
        });
    });
});
