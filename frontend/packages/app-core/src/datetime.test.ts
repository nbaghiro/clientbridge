import { describe, expect, it } from "vitest";

import {
    dateKey,
    daysUntil,
    parseTimestamp,
    relativeDay,
    relativeDayTime,
    stampLabel,
    weekdayDay,
} from "./datetime";

describe("parseTimestamp", () => {
    it("parses PowerSync's bare-offset timestamptz as UTC", () => {
        // "2026-06-26 10:00:00+00" is the exact stored form the calendar filtering depends on.
        const d = parseTimestamp("2026-06-26 10:00:00+00");
        expect(d.getUTCFullYear()).toBe(2026);
        expect(d.getUTCMonth()).toBe(5); // June (0-indexed)
        expect(d.getUTCHours()).toBe(10);
        expect(d.getUTCMinutes()).toBe(0);
    });

    it("parses the ISO Z form to the same instant", () => {
        expect(parseTimestamp("2026-06-26T10:00:00Z").getTime()).toBe(
            parseTimestamp("2026-06-26 10:00:00+00").getTime(),
        );
    });

    it("treats an offset-less value as UTC", () => {
        expect(parseTimestamp("2026-06-26 10:00:00").getUTCHours()).toBe(10);
    });
});

describe("dateKey", () => {
    it("formats a local date as YYYY-MM-DD", () => {
        expect(dateKey(new Date(2026, 5, 9))).toBe("2026-06-09");
    });
});

describe("relative days", () => {
    const now = new Date(2026, 9, 6, 9, 30);

    it("names today, yesterday and tomorrow", () => {
        expect(relativeDay(new Date(2026, 9, 6, 18), "short", now)).toBe("Today");
        expect(relativeDay(new Date(2026, 9, 5, 8), "short", now)).toBe("Yesterday");
        expect(relativeDay(new Date(2026, 9, 7, 8), "short", now)).toBe("Tomorrow");
    });

    it("falls back to the date further out", () => {
        const d = new Date(2026, 9, 8, 9);
        expect(relativeDay(d, "short", now)).toBe(weekdayDay(d));
        expect(relativeDayTime(new Date(2026, 9, 6, 14, 30), now)).toMatch(/^Today, 2:30/);
    });

    it("stamps a feed row by how long ago it was", () => {
        expect(stampLabel(new Date(2026, 9, 6, 8, 52), now)).toMatch(/^8:52/);
        expect(stampLabel(new Date(2026, 9, 3, 8, 52), now)).toMatch(/^Sat 8:52/);
        expect(stampLabel(new Date(2026, 8, 1, 8, 52), now)).toMatch(/2026/);
    });

    it("counts calendar days, not hours", () => {
        expect(daysUntil(new Date(2026, 9, 31, 1), now)).toBe(25);
        expect(daysUntil(new Date(2026, 8, 26, 23), now)).toBe(-10);
    });
});
