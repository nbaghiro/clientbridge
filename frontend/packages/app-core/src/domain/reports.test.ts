import { describe, expect, it } from "vitest";

import { periodSpan, spanLabel } from "./reports";
import { zonedDate } from "../datetime";

const ZONE = "America/Vancouver";

const now = zonedDate(2026, 10, 6, 12, 0, ZONE);

describe("periodSpan", () => {
    it("covers this month up to today", () => {
        expect(periodSpan("thisMonth", ZONE, now)).toEqual({
            start: "2026-10-01",
            end: "2026-10-06",
        });
    });

    it("covers the whole of last month", () => {
        expect(periodSpan("lastMonth", ZONE, now)).toEqual({
            start: "2026-09-01",
            end: "2026-09-30",
        });
        expect(periodSpan("lastMonth", ZONE, zonedDate(2026, 1, 15, 0, 0, ZONE))).toEqual({
            start: "2025-12-01",
            end: "2025-12-31",
        });
    });

    it("covers the last full quarter, across a year end", () => {
        expect(periodSpan("lastQuarter", ZONE, now)).toEqual({
            start: "2026-07-01",
            end: "2026-09-30",
        });
        expect(periodSpan("lastQuarter", ZONE, zonedDate(2026, 2, 2, 0, 0, ZONE))).toEqual({
            start: "2025-10-01",
            end: "2025-12-31",
        });
    });

    it("covers the year so far", () => {
        expect(periodSpan("ytd", ZONE, now)).toEqual({ start: "2026-01-01", end: "2026-10-06" });
    });

    it("names a span in words", () => {
        expect(spanLabel({ start: "2026-07-01", end: "2026-09-30" })).toBe("Jul 1 to Sep 30, 2026");
    });
});
