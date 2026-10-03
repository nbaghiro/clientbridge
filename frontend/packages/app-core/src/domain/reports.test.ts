import { describe, expect, it } from "vitest";

import { nextRemittancePeriod } from "./reports";

const now = new Date(2026, 9, 3, 12);

describe("nextRemittancePeriod", () => {
    it("starts on Jan 1 when nothing has been filed", () => {
        expect(nextRemittancePeriod([], now)).toEqual({ start: "2026-01-01", end: "2026-10-02" });
    });

    it("starts the day after the latest filed period", () => {
        const filed = [
            { id: "j2", period_start: "2026-07-01", period_end: "2026-09-30", total_cents: 500 },
            { id: "j1", period_start: "2026-01-01", period_end: "2026-06-30", total_cents: 900 },
        ];
        expect(nextRemittancePeriod(filed, now)).toEqual({
            start: "2026-10-01",
            end: "2026-10-02",
        });
    });

    it("is empty when the latest return already covers yesterday", () => {
        const filed = [
            { id: "j1", period_start: "2026-07-01", period_end: "2026-10-02", total_cents: 500 },
        ];
        const period = nextRemittancePeriod(filed, now);
        expect(period.start > period.end).toBe(true);
    });
});
