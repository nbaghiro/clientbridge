import { describe, expect, it } from "vitest";

import { periodSpan, spanLabel } from "./reports";

const now = new Date(2026, 9, 6, 12);

describe("periodSpan", () => {
    it("covers this month up to today", () => {
        expect(periodSpan("thisMonth", now)).toEqual({ start: "2026-10-01", end: "2026-10-06" });
    });

    it("covers the whole of last month", () => {
        expect(periodSpan("lastMonth", now)).toEqual({ start: "2026-09-01", end: "2026-09-30" });
        expect(periodSpan("lastMonth", new Date(2026, 0, 15))).toEqual({
            start: "2025-12-01",
            end: "2025-12-31",
        });
    });

    it("covers the last full quarter, across a year end", () => {
        expect(periodSpan("lastQuarter", now)).toEqual({ start: "2026-07-01", end: "2026-09-30" });
        expect(periodSpan("lastQuarter", new Date(2026, 1, 2))).toEqual({
            start: "2025-10-01",
            end: "2025-12-31",
        });
    });

    it("covers the year so far", () => {
        expect(periodSpan("ytd", now)).toEqual({ start: "2026-01-01", end: "2026-10-06" });
    });

    it("names a span in words", () => {
        expect(spanLabel({ start: "2026-07-01", end: "2026-09-30" })).toBe("Jul 1 to Sep 30, 2026");
    });
});
