import { describe, expect, it } from "vitest";

import {
    addDays,
    addMonths,
    clockOptions,
    formatPickedDay,
    monthWeeks,
    parseDateKey,
    combineDayAndTime,
    dateKey,
    daysUntil,
    formatRelativeTime,
    parseTimestamp,
    relativeDay,
    relativeDayTime,
    sameDay,
    stampLabel,
    startOfDay,
    startOfMonth,
    startOfWeek,
    weekdayDay,
} from "./datetime";
import { strings } from "./strings";

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

describe("day arithmetic", () => {
    const wed = new Date(2026, 9, 7, 15, 30);

    it("snaps to local midnight and the first of the month", () => {
        expect(startOfDay(wed)).toEqual(new Date(2026, 9, 7));
        expect(startOfDay(new Date(2026, 9, 7))).toEqual(new Date(2026, 9, 7));
        expect(startOfMonth(wed)).toEqual(new Date(2026, 9, 1));
        expect(startOfMonth(new Date(2027, 0, 31, 23, 59))).toEqual(new Date(2027, 0, 1));
    });

    it("adds calendar days across month and year ends, landing on midnight", () => {
        expect(addDays(wed, 1)).toEqual(new Date(2026, 9, 8));
        expect(addDays(wed, 0)).toEqual(new Date(2026, 9, 7));
        expect(addDays(new Date(2026, 9, 31), 1)).toEqual(new Date(2026, 10, 1));
        expect(addDays(new Date(2027, 0, 1), -1)).toEqual(new Date(2026, 11, 31));
        expect(addDays(new Date(2028, 1, 28), 1)).toEqual(new Date(2028, 1, 29));
        expect(addDays(new Date(2026, 1, 28), 1)).toEqual(new Date(2026, 2, 1));
    });

    it("starts the week on Monday unless told otherwise", () => {
        expect(startOfWeek(wed)).toEqual(new Date(2026, 9, 5));
        expect(startOfWeek(new Date(2026, 9, 5, 8))).toEqual(new Date(2026, 9, 5));
        expect(startOfWeek(new Date(2026, 9, 11, 22))).toEqual(new Date(2026, 9, 5));
        expect(startOfWeek(wed, 0)).toEqual(new Date(2026, 9, 4));
        expect(startOfWeek(new Date(2027, 0, 1), 1)).toEqual(new Date(2026, 11, 28));
    });

    it("compares calendar days, not instants", () => {
        expect(sameDay(new Date(2026, 9, 7, 0, 0), new Date(2026, 9, 7, 23, 59))).toBe(true);
        expect(sameDay(new Date(2026, 9, 7, 23, 59), new Date(2026, 9, 8, 0, 0))).toBe(false);
        expect(sameDay(new Date(2026, 9, 7), new Date(2026, 8, 7))).toBe(false);
        expect(sameDay(new Date(2026, 9, 7), new Date(2027, 9, 7))).toBe(false);
    });

    it("puts a typed time on a day given as a date or a key", () => {
        expect(combineDayAndTime("2026-10-07", "14:30")).toEqual(new Date(2026, 9, 7, 14, 30));
        expect(combineDayAndTime(wed, "09:05")).toEqual(new Date(2026, 9, 7, 9, 5));
        expect(combineDayAndTime("2026-12-31", "9")).toEqual(new Date(2026, 11, 31, 9, 0));
        expect(combineDayAndTime("2026-10-07", "00:00")).toEqual(new Date(2026, 9, 7));
    });
});

describe("formatRelativeTime", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    const ago = (ms: number): string => new Date(now.getTime() - ms).toISOString();
    const t = strings.common.relativeTime;
    const MIN = 60_000;

    it("steps from just now through minutes, hours and days", () => {
        expect(formatRelativeTime(ago(0), now)).toBe(t.justNow);
        expect(formatRelativeTime(ago(59_999), now)).toBe(t.justNow);
        expect(formatRelativeTime(ago(-5 * MIN), now)).toBe(t.justNow);
        expect(formatRelativeTime(ago(MIN), now)).toBe(t.minutes(1));
        expect(formatRelativeTime(ago(59 * MIN), now)).toBe(t.minutes(59));
        expect(formatRelativeTime(ago(60 * MIN), now)).toBe(t.hours(1));
        expect(formatRelativeTime(ago(24 * 60 * MIN - 1), now)).toBe(t.hours(23));
        expect(formatRelativeTime(ago(24 * 60 * MIN), now)).toBe(t.days(1));
        expect(formatRelativeTime(ago(7 * 24 * 60 * MIN - 1), now)).toBe(t.days(6));
    });

    it("falls back to a short date after a week, reading the replica's timestamp form", () => {
        const old = ago(8 * 24 * 60 * MIN);
        expect(formatRelativeTime(old, now)).toBe(
            new Date(old).toLocaleDateString("en-CA", { month: "short", day: "numeric" }),
        );
        expect(formatRelativeTime("2026-10-07 11:30:00+00", now)).toBe(t.minutes(30));
    });
});

describe("date picker helpers", () => {
    it("reads only real days from a date key", () => {
        expect(parseDateKey("2026-10-08")?.getDate()).toBe(8);
        expect(parseDateKey("2026-02-30")).toBeNull();
        expect(parseDateKey("")).toBeNull();
    });

    it("holds the day to the end of a shorter month", () => {
        expect(dateKey(addMonths(new Date(2026, 0, 31), 1))).toBe("2026-02-28");
        expect(dateKey(addMonths(new Date(2026, 2, 15), -12))).toBe("2025-03-15");
    });

    it("lays out six Monday-first weeks with the bounds disabled", () => {
        const weeks = monthWeeks(
            new Date(2026, 9, 1),
            "2026-10-08",
            { min: "2026-10-05" },
            new Date(2026, 9, 7),
        );
        expect(weeks).toHaveLength(6);
        expect(weeks[0]?.[0]?.key).toBe("2026-09-28");
        const days = weeks.flat();
        expect(days.find((d) => d.selected)?.key).toBe("2026-10-08");
        expect(days.find((d) => d.today)?.key).toBe("2026-10-07");
        expect(days.find((d) => d.key === "2026-10-04")?.disabled).toBe(true);
        expect(days.find((d) => d.key === "2026-10-05")?.disabled).toBe(false);
    });

    it("drops the year only for the current year", () => {
        const now = new Date(2026, 9, 7);
        expect(formatPickedDay(new Date(2026, 9, 8), now)).not.toMatch(/2026/);
        expect(formatPickedDay(new Date(2027, 9, 8), now)).toMatch(/2027/);
    });

    it("steps through the day and keeps a time that falls between steps", () => {
        const keys = clockOptions(30, "09:00", "11:00", "10:07").map((o) => o.key);
        expect(keys).toEqual(["09:00", "09:30", "10:00", "10:07", "10:30", "11:00"]);
        expect(clockOptions(15)).toHaveLength(96);
    });
});
