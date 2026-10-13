import { describe, expect, it } from "vitest";

import parity from "../taxes.cases.json" with { type: "json" };
import { docRates, priceDoc } from "./billing";
import { asTaxClass, filingPeriod, ratesOn, taxExample, taxSummary } from "./taxes";
import { dateKey, zonedDate } from "../datetime";

const ZONE = "America/Vancouver";
const DAY = "2026-10-13";

describe("taxSummary", () => {
    it("names each province's taxes and keeps only GST or HST for federal-only items", () => {
        expect(taxSummary("BC", DAY)).toBe("GST 5% + PST 7%");
        expect(taxSummary("BC", DAY, "federal_only")).toBe("GST 5%");
        expect(taxSummary("SK", DAY)).toBe("GST 5% + PST 6%");
        expect(taxSummary("ON", DAY)).toBe("HST 13%");
        expect(taxSummary("ON", DAY, "federal_only")).toBe("HST 13%");
        expect(taxSummary("NS", DAY)).toBe("HST 14%");
        expect(taxSummary("AB", DAY)).toBe("GST 5%");
        expect(taxSummary(null, DAY)).toBe("GST 5%");
        expect(taxSummary("ZZ", DAY)).toBe("GST 5%");
    });
});

describe("the device engine against services/tax.py", () => {
    const lines = parity.lines.map((l) => ({
        amountCents: l.amountCents,
        taxClass: asTaxClass(l.taxClass),
        included: true,
    }));

    it.each(parity.cases)(
        "$province on $on, registered $registered, inclusive $inclusive",
        ({ province, on, registered, inclusive, expected }) => {
            const priced = priceDoc(lines, docRates(ratesOn(province, on), registered), inclusive);
            expect(priced.lines.map((l) => [l.baseCents, l.taxByCode])).toEqual(expected.lines);
            expect(priced.subtotalCents).toBe(expected.subtotalCents);
            expect(priced.taxCents).toBe(expected.taxCents);
            expect(priced.totalCents).toBe(expected.totalCents);
            expect(Object.fromEntries(priced.taxes.map((t) => [t.code, t.cents]))).toEqual(
                Object.fromEntries(Object.entries(expected.byCode).filter(([, c]) => c !== 0)),
            );
        },
    );

    it("takes Nova Scotia's HST from 15% to 14% on 2025-04-01", () => {
        expect(ratesOn("NS", "2025-03-31")).toEqual([{ code: "HST", ppm: 150_000 }]);
        expect(ratesOn("NS", "2025-04-01")).toEqual([{ code: "HST", ppm: 140_000 }]);
        expect(ratesOn("ZZ", "2026-07-01")).toEqual([]);
    });
});

describe("tax on the business's date", () => {
    it("reads the rates of the business's calendar day, not the UTC one", () => {
        // 8 p.m. in Vancouver on March 31, 2025, already April 1 in UTC
        const evening = new Date("2025-04-01T03:00:00Z");
        expect(taxSummary("NS", dateKey(evening, ZONE))).toBe("HST 15%");
        expect(taxSummary("NS", "2025-04-01")).toBe("HST 14%");
    });
});

describe("taxExample", () => {
    it("works the tax on $100 per class, half cents rounded", () => {
        expect(taxExample("standard", "BC", true, DAY)).toEqual({
            lines: [
                { label: "GST 5%", cents: 500 },
                { label: "PST 7%", cents: 700 },
            ],
            totalCents: 11200,
        });
        expect(taxExample("federal_only", "BC", true, DAY)).toEqual({
            lines: [{ label: "GST 5%", cents: 500 }],
            totalCents: 10500,
        });
        expect(taxExample("standard", "ON", true, DAY, 999)).toEqual({
            lines: [{ label: "HST 13%", cents: 130 }],
            totalCents: 1129,
        });
        expect(taxExample("standard", "BC", true, DAY, 999).lines.map((l) => l.cents)).toEqual([
            50, 70,
        ]);
        expect(taxExample("standard", "NS", true, DAY, 1001).totalCents).toBe(1141);
        expect(taxExample("standard", "QC", true, DAY, 100000).lines.map((l) => l.cents)).toEqual([
            5000, 9975,
        ]);
        expect(taxSummary("MB", DAY)).toBe("GST 5% + PST 7%");
        expect(taxSummary("QC", DAY)).toBe("GST 5% + QST 9.975%");
    });

    it("collects nothing on exempt items or for a small supplier", () => {
        expect(taxExample("exempt", "BC", true, DAY)).toEqual({ lines: [], totalCents: 10000 });
        expect(taxExample("standard", "BC", false, DAY)).toEqual({ lines: [], totalCents: 10000 });
        expect(taxExample("standard", "BC", true, DAY, 0)).toEqual({
            lines: [
                { label: "GST 5%", cents: 0 },
                { label: "PST 7%", cents: 0 },
            ],
            totalCents: 0,
        });
    });
});

describe("filingPeriod", () => {
    const d = (y: number, m: number, day: number, h = 12) => zonedDate(y, m, day, h, 0, ZONE);

    it("finds the quarter holding today, due a month after it ends", () => {
        expect(filingPeriod("quarterly", ZONE, d(2026, 2, 15))).toEqual({
            from: d(2026, 1, 1, 0),
            to: d(2026, 3, 31, 0),
            due: d(2026, 4, 30, 0),
        });
        expect(filingPeriod("quarterly", ZONE, d(2026, 3, 31, 23))).toMatchObject({
            from: d(2026, 1, 1, 0),
        });
        expect(filingPeriod("quarterly", ZONE, d(2026, 4, 1, 0))).toEqual({
            from: d(2026, 4, 1, 0),
            to: d(2026, 6, 30, 0),
            due: d(2026, 7, 31, 0),
        });
        expect(filingPeriod("quarterly", ZONE, d(2026, 11, 15))).toEqual({
            from: d(2026, 10, 1, 0),
            to: d(2026, 12, 31, 0),
            due: d(2027, 1, 31, 0),
        });
    });

    it("handles monthly periods, February included, and the calendar year", () => {
        expect(filingPeriod("monthly", ZONE, d(2026, 12, 10))).toEqual({
            from: d(2026, 12, 1, 0),
            to: d(2026, 12, 31, 0),
            due: d(2027, 1, 31, 0),
        });
        expect(filingPeriod("monthly", ZONE, d(2028, 2, 29))).toEqual({
            from: d(2028, 2, 1, 0),
            to: d(2028, 2, 29, 0),
            due: d(2028, 3, 31, 0),
        });
        expect(filingPeriod("monthly", ZONE, d(2026, 1, 20)).due).toEqual(d(2026, 2, 28, 0));
        expect(filingPeriod("annual", ZONE, d(2026, 7, 1))).toEqual({
            from: d(2026, 1, 1, 0),
            to: d(2026, 12, 31, 0),
            due: d(2027, 4, 30, 0),
        });
    });
});
