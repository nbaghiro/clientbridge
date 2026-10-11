import { afterEach, describe, expect, it } from "vitest";

import cases from "./zones.cases.json" with { type: "json" };
import { BUNDLED_ZONES, SUPPORTED_ZONES } from "./zones";
import {
    adoptZoneTable,
    addDays,
    addMonths,
    clockKey,
    clockOptions,
    combineDayAndTime,
    dateKey,
    dayKey,
    daysUntil,
    firstWeekday,
    formatClock,
    formatClockShort,
    formatDate,
    formatDateTime,
    formatDayTime,
    formatFullDate,
    formatHour,
    formatLongDate,
    formatPickedDay,
    formatRelativeTime,
    formatShortTimeRange,
    formatTime,
    formatTimeOfPeriod,
    formatTimeRange,
    formatWeekdayName,
    formatWeekdayTime,
    formatZoneName,
    minutesInto,
    monthWeeks,
    parseDateKey,
    parseTimestamp,
    parseWallDateTime,
    readDate,
    relativeDay,
    relativeDayTime,
    sameDay,
    stampLabel,
    startOfDay,
    startOfMonth,
    startOfWeek,
    sameClock,
    wallTime,
    weekdayDay,
    zoneTableVersion,
    weekdayNames,
    zonedDate,
} from "./datetime";
import { setPseudoLocale } from "./locale";
import { strings } from "./strings";

const VAN = "America/Vancouver";
const TOKYO = "Asia/Tokyo";
// British Columbia stays on UTC-7 from November 2026, so the fall-back checks use Toronto.
const TORONTO = "America/Toronto";
const HALIFAX = "America/Halifax";

// Wednesday 7 October 2026, 3:30 p.m. on a Vancouver clock (22:30 UTC).
const WED = zonedDate(2026, 10, 7, 15, 30, VAN);
const at = (month: number, day: number, hour = 0, minute = 0): Date =>
    zonedDate(2026, month, day, hour, minute, VAN);

afterEach(async () => {
    await setPseudoLocale(false);
});

describe("parseTimestamp", () => {
    it("parses PowerSync's bare-offset timestamptz as UTC", () => {
        const d = parseTimestamp("2026-06-26 10:00:00+00");
        expect(d.toISOString()).toBe("2026-06-26T10:00:00.000Z");
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

describe("zoned clocks", () => {
    it("reads an instant's fields on the given zone's clock", () => {
        const instant = new Date("2026-10-07T22:30:00Z");
        expect(wallTime(instant, VAN)).toMatchObject({ year: 2026, month: 10, day: 7, hour: 15 });
        expect(wallTime(instant, TOKYO)).toMatchObject({ month: 10, day: 8, hour: 7, minute: 30 });
        expect(wallTime(instant, HALIFAX)).toMatchObject({ day: 7, hour: 19, weekday: 3 });
    });

    it("finds the instant a zone's clock shows, across both daylight saving changes", () => {
        expect(zonedDate(2026, 10, 7, 15, 30, VAN).toISOString()).toBe("2026-10-07T22:30:00.000Z");
        expect(zonedDate(2026, 1, 15, 9, 0, VAN).toISOString()).toBe("2026-01-15T17:00:00.000Z");
        expect(zonedDate(2026, 3, 8, 12, 0, VAN).toISOString()).toBe("2026-03-08T19:00:00.000Z");
        expect(zonedDate(2026, 11, 1, 12, 0, TORONTO).toISOString()).toBe(
            "2026-11-01T17:00:00.000Z",
        );
        expect(zonedDate(2026, 10, 32, 0, 0, TOKYO).toISOString()).toBe("2026-10-31T15:00:00.000Z");
    });

    it("keys days and clock times by the zone, not the device", () => {
        const lateEvening = new Date("2026-10-08T05:30:00Z");
        expect(dateKey(lateEvening, VAN)).toBe("2026-10-07");
        expect(dateKey(lateEvening, TOKYO)).toBe("2026-10-08");
        expect(clockKey(lateEvening, VAN)).toBe("22:30");
        expect(dayKey(2026, 13, 0)).toBe("2026-12-31");
    });
});

describe("day arithmetic", () => {
    it("snaps to midnight and the first of the month in the zone", () => {
        expect(startOfDay(WED, VAN)).toEqual(at(10, 7));
        expect(startOfDay(at(10, 7), VAN)).toEqual(at(10, 7));
        expect(startOfMonth(WED, VAN)).toEqual(at(10, 1));
        expect(startOfMonth(zonedDate(2027, 1, 31, 23, 59, VAN), VAN)).toEqual(
            zonedDate(2027, 1, 1, 0, 0, VAN),
        );
    });

    it("adds calendar days across month ends and daylight saving, landing on midnight", () => {
        expect(addDays(WED, 1, VAN)).toEqual(at(10, 8));
        expect(addDays(WED, 0, VAN)).toEqual(at(10, 7));
        expect(addDays(at(10, 31), 1, VAN)).toEqual(at(11, 1));
        const halloween = zonedDate(2026, 10, 31, 0, 0, TORONTO);
        expect(addDays(halloween, 2, TORONTO).getTime() - halloween.getTime()).toBe(49 * 3_600_000);
        expect(addDays(zonedDate(2028, 2, 28, 0, 0, VAN), 1, VAN)).toEqual(
            zonedDate(2028, 2, 29, 0, 0, VAN),
        );
    });

    it("starts the week on Monday for English", () => {
        expect(firstWeekday()).toBe(1);
        expect(startOfWeek(WED, VAN)).toEqual(at(10, 5));
        expect(startOfWeek(at(10, 11, 22), VAN)).toEqual(at(10, 5));
        expect(startOfWeek(zonedDate(2027, 1, 1, 0, 0, VAN), VAN)).toEqual(at(12, 28));
    });

    it("compares calendar days in the zone", () => {
        expect(sameDay(at(10, 7, 0, 0), at(10, 7, 23, 59), VAN)).toBe(true);
        expect(sameDay(at(10, 7, 23, 59), at(10, 8, 0, 0), VAN)).toBe(false);
        expect(sameDay(at(10, 7, 6), at(10, 7, 10), TOKYO)).toBe(false);
    });

    it("puts a typed time on a day given as a date or a key", () => {
        expect(combineDayAndTime("2026-10-07", "14:30", VAN)).toEqual(at(10, 7, 14, 30));
        expect(combineDayAndTime(WED, "09:05", VAN)).toEqual(at(10, 7, 9, 5));
        expect(combineDayAndTime("2026-12-31", "9", VAN)).toEqual(at(12, 31, 9));
        expect(parseWallDateTime("2026-10-07T14:30", TOKYO).toISOString()).toBe(
            "2026-10-07T05:30:00.000Z",
        );
        expect(minutesInto(WED, 90, VAN)).toEqual(at(10, 7, 1, 30));
    });

    it("counts calendar days, not hours", () => {
        const now = at(10, 6, 9, 30);
        expect(daysUntil(at(10, 31, 1), VAN, now)).toBe(25);
        expect(daysUntil(at(9, 26, 23), VAN, now)).toBe(-10);
    });

    it("reads a stored date-only value as that day in the zone", () => {
        expect(readDate("2026-10-08", VAN)).toEqual(at(10, 8));
        expect(readDate("2026-10-08T12:00:00Z", VAN).toISOString()).toBe(
            "2026-10-08T12:00:00.000Z",
        );
    });
});

describe("formatting", () => {
    it("formats times and dates on the zone's clock in English", () => {
        const instant = new Date("2026-10-09T21:30:00Z");
        expect(formatTime(instant, VAN)).toBe("2:30 p.m.");
        expect(formatTime(instant, TOKYO)).toBe("6:30 a.m.");
        expect(formatDate(instant, VAN)).toBe("Oct 9, 2026");
        expect(formatLongDate(instant, VAN)).toBe("October 9, 2026");
        expect(formatFullDate(instant, VAN)).toBe("Friday, October 9");
        expect(weekdayDay(instant, TOKYO)).toBe("Sat, Oct 10");
        expect(formatDayTime(instant, VAN)).toBe("Fri, Oct 9, 2:30 p.m.");
        expect(formatDateTime(instant, VAN)).toBe("Oct 9, 2026, 2:30 p.m.");
        expect(formatWeekdayTime(instant, VAN)).toBe("Fri 2:30 p.m.");
    });

    it("formats wall-clock times on a 12-hour clock for English", () => {
        expect(formatClock("09:30")).toBe("9:30 a.m.");
        expect(formatClock("17:00")).toBe("5:00 p.m.");
        expect(formatHour(0)).toBe("12 a.m.");
        expect(formatHour(13)).toBe("1 p.m.");
        expect(formatClockShort("09:00")).toBe("9");
        expect(formatClockShort("16:30")).toBe("4:30");
    });

    it("joins ranges through the catalog and shares the period in compact ranges", () => {
        const start = at(10, 7, 9, 30);
        const end = at(10, 7, 10, 15);
        expect(formatTimeRange(start, end, VAN)).toBe("9:30 a.m. – 10:15 a.m.");
        expect(formatShortTimeRange(start, end, VAN)).toBe("9:30–10:15 a.m.");
        expect(formatTimeOfPeriod(at(10, 7, 21, 5), VAN)).toBe("9:05");
    });

    it("names weekdays in week order and the zone a visitor sees", () => {
        expect(weekdayNames()).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
        expect(formatWeekdayName(0)).toBe("Sunday");
        expect(formatZoneName(VAN, WED)).toBe("Pacific Time");
        expect(formatZoneName(HALIFAX, WED)).toBe("Atlantic Time");
    });

    it("follows the pseudo-locale for the formatted values", async () => {
        await setPseudoLocale(true);
        const start = at(10, 7, 9, 30);
        expect(formatTime(start, VAN)).toBe("9:30 AM");
        expect(formatTimeRange(start, at(10, 7, 10), VAN)).toBe("9:30 AM – 10:00 AM");
    });
});

describe("relative days", () => {
    const now = at(10, 6, 9, 30);

    it("names today, yesterday and tomorrow in the zone", () => {
        expect(relativeDay(at(10, 6, 18), VAN, "short", now)).toBe("Today");
        expect(relativeDay(at(10, 5, 8), VAN, "short", now)).toBe("Yesterday");
        expect(relativeDay(at(10, 7, 8), VAN, "short", now)).toBe("Tomorrow");
        expect(relativeDay(at(10, 6, 6), VAN, "short", now)).toBe("Today");
        expect(relativeDay(at(10, 6, 6), TOKYO, "short", now)).toBe("Yesterday");
    });

    it("falls back to the date further out", () => {
        const d = at(10, 8, 9);
        expect(relativeDay(d, VAN, "short", now)).toBe(weekdayDay(d, VAN));
        expect(relativeDay(d, VAN, "long", now)).toBe("Thursday, October 8");
        expect(relativeDayTime(at(10, 6, 14, 30), VAN, now)).toBe("Today, 2:30 p.m.");
        expect(relativeDayTime(d, VAN, now)).toBe("Thu, Oct 8, 9:00 a.m.");
    });

    it("stamps a feed row by how long ago it was", () => {
        expect(stampLabel(at(10, 6, 8, 52), VAN, now)).toBe("8:52 a.m.");
        expect(stampLabel(at(10, 3, 8, 52), VAN, now)).toBe("Sat 8:52 a.m.");
        expect(stampLabel(at(9, 1, 8, 52), VAN, now)).toBe("Sep 1, 2026");
    });
});

describe("formatRelativeTime", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    const ago = (ms: number): string => new Date(now.getTime() - ms).toISOString();
    const t = strings.common.relativeTime;
    const MIN = 60_000;

    it("steps from just now through minutes, hours and days", () => {
        expect(formatRelativeTime(ago(0), VAN, now)).toBe(t.justNow);
        expect(formatRelativeTime(ago(59_999), VAN, now)).toBe(t.justNow);
        expect(formatRelativeTime(ago(-5 * MIN), VAN, now)).toBe(t.justNow);
        expect(formatRelativeTime(ago(MIN), VAN, now)).toBe(t.minutes(1));
        expect(formatRelativeTime(ago(59 * MIN), VAN, now)).toBe(t.minutes(59));
        expect(formatRelativeTime(ago(60 * MIN), VAN, now)).toBe(t.hours(1));
        expect(formatRelativeTime(ago(24 * 60 * MIN - 1), VAN, now)).toBe(t.hours(23));
        expect(formatRelativeTime(ago(24 * 60 * MIN), VAN, now)).toBe(t.days(1));
        expect(formatRelativeTime(ago(7 * 24 * 60 * MIN - 1), VAN, now)).toBe(t.days(6));
    });

    it("falls back to a short date in the zone after a week", () => {
        expect(formatRelativeTime("2026-09-29T03:00:00Z", VAN, now)).toBe("Sep 28");
        expect(formatRelativeTime("2026-09-29T03:00:00Z", TOKYO, now)).toBe("Sep 29");
        expect(formatRelativeTime("2026-10-07 11:30:00+00", VAN, now)).toBe(t.minutes(30));
    });
});

describe("date picker helpers", () => {
    it("reads only real days from a date key", () => {
        expect(parseDateKey("2026-10-08", VAN)).toEqual(at(10, 8));
        expect(parseDateKey("2026-02-30", VAN)).toBeNull();
        expect(parseDateKey("", VAN)).toBeNull();
    });

    it("holds the day to the end of a shorter month", () => {
        expect(dateKey(addMonths(zonedDate(2026, 1, 31, 0, 0, VAN), 1, VAN), VAN)).toBe(
            "2026-02-28",
        );
        expect(dateKey(addMonths(at(3, 15), -12, VAN), VAN)).toBe("2025-03-15");
    });

    it("lays out six Monday-first weeks with the bounds disabled", () => {
        const weeks = monthWeeks(at(10, 1), "2026-10-08", { min: "2026-10-05" }, VAN, at(10, 7));
        expect(weeks).toHaveLength(6);
        expect(weeks[0]?.[0]?.key).toBe("2026-09-28");
        const days = weeks.flat();
        expect(days.find((d) => d.selected)?.key).toBe("2026-10-08");
        expect(days.find((d) => d.today)?.key).toBe("2026-10-07");
        expect(days.find((d) => d.key === "2026-10-04")?.disabled).toBe(true);
        expect(days.find((d) => d.key === "2026-10-05")?.disabled).toBe(false);
        expect(days.find((d) => d.key === "2026-10-31")?.label).toBe("Saturday, October 31");
    });

    it("drops the year only for the current year", () => {
        const now = at(10, 7);
        expect(formatPickedDay(at(10, 8), VAN, now)).toBe("Thu, Oct 8");
        expect(formatPickedDay(zonedDate(2027, 10, 8, 0, 0, VAN), VAN, now)).toBe(
            "Fri, Oct 8, 2027",
        );
    });

    it("steps through the day and keeps a time that falls between steps", () => {
        const keys = clockOptions(30, "09:00", "11:00", "10:07").map((o) => o.key);
        expect(keys).toEqual(["09:00", "09:30", "10:00", "10:07", "10:30", "11:00"]);
        expect(clockOptions(15)).toHaveLength(96);
        expect(clockOptions(30, "09:00", "09:30").map((o) => o.label)).toEqual([
            "9:00 a.m.",
            "9:30 a.m.",
        ]);
    });
});

describe.each([
    {
        tag: "en-CA",
        dates: ["Oct 7, 2026", "October 7, 2026", "Wed, Oct 7, 9:30 a.m."],
        times: ["9:30 a.m.", "9:30 a.m. – 2:00 p.m."],
        relative: "2h",
    },
    {
        tag: "en-XA",
        dates: ["Oct 7, 2026", "October 7, 2026", "Wed, Oct 7, 9:30 AM"],
        times: ["9:30 AM", "9:30 AM – 2:00 PM"],
        relative: "[2ĥ one]",
    },
])("dates and times in $tag", ({ tag, dates, times, relative }) => {
    const start = at(10, 7, 9, 30);

    it("formats dates, times, ranges and relative times in the business zone", async () => {
        await setPseudoLocale(tag === "en-XA");
        expect([
            formatDate(start, VAN),
            formatLongDate(start, VAN),
            formatDayTime(start, VAN),
        ]).toEqual(dates);
        expect([formatTime(start, VAN), formatTimeRange(start, at(10, 7, 14), VAN)]).toEqual(times);
        expect(
            formatRelativeTime("2026-10-07T16:00:00Z", VAN, new Date("2026-10-07T18:00:00Z")),
        ).toBe(relative);
    });
});

const pad = (n: number): string => String(n).padStart(2, "0");

describe("the server's zone table", () => {
    it("reads every instant the way the backend's tzdata does", () => {
        for (const c of cases) {
            const w = wallTime(new Date(c.at), c.zone);
            expect(
                `${String(w.year)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`,
                c.zone,
            ).toBe(c.wall);
        }
    });

    it("finds the instant of an unambiguous wall clock the backend computed", () => {
        for (const c of cases.filter((x) => x.wall.endsWith("T12:00"))) {
            const [y = 0, m = 0, d = 0] = c.wall.slice(0, 10).split("-").map(Number);
            expect(+zonedDate(y, m, d, 12, 0, c.zone), c.zone).toBe(c.at);
        }
    });

    it("covers each supported zone and keeps Vancouver on UTC-7 after 2026-11-01", () => {
        expect(Object.keys(BUNDLED_ZONES.zones)).toEqual([...SUPPORTED_ZONES]);
        expect(wallTime(new Date("2026-12-01T19:00:00Z"), VAN).hour).toBe(12);
        expect(sameClock(VAN, "America/Whitehorse", new Date("2026-12-01T19:00:00Z"))).toBe(true);
    });

    it("adopts only a newer table", () => {
        const older = { version: "2001.1", zones: { [VAN]: [[0, -480]] as const } };
        expect(adoptZoneTable(older)).toBe(false);
        const version = zoneTableVersion();
        const newer = {
            version: "2999.1",
            zones: { ...BUNDLED_ZONES.zones, [VAN]: [[0, -480]] as const },
        };
        expect(adoptZoneTable(newer)).toBe(true);
        expect(wallTime(new Date("2026-12-01T19:00:00Z"), VAN).hour).toBe(11);
        expect(adoptZoneTable({ ...BUNDLED_ZONES, version: "3000.1" })).toBe(true);
        expect(zoneTableVersion()).not.toBe(version);
    });
});
