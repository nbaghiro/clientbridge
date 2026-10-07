import { describe, expect, it } from "vitest";

import { formatTime, formatWeekday, weekdayDay } from "../datetime";
import { strings } from "../strings";
import { type CalendarEvent, buildAvailability } from "./bookings";
import {
    buildOccurrences,
    datesOf,
    patternLabel,
    problemAt,
    stepDate,
    suggest,
    summarize,
} from "./recurrences";
import type { StaffRow } from "./staff";

const s = strings.recurrences;

type Ctx = Parameters<typeof problemAt>[0];
type HoursRow = Parameters<typeof buildAvailability>[0][number];
type SeriesRow = Parameters<typeof datesOf>[0];
type VisitRow = Parameters<typeof datesOf>[1][number];

// Wednesday 7 October 2026 in local time.
const at = (day: number, h: number, m = 0, month = 9): Date => new Date(2026, month, day, h, m);
const none = () => false;

const amy: StaffRow = {
    id: "st_amy",
    user_id: null,
    name: "Amy Lee",
    title: null,
    role: "staff",
    color: null,
    status: "active",
    invite_email: null,
};

const hours = (extra: Partial<HoursRow>): HoursRow => ({
    staff_id: "st_amy",
    basis: "recurring",
    weekday: 2,
    date: null,
    start_time: "09:00:00",
    end_time: "17:00:00",
    available: 1,
    ...extra,
});

function visit(id: string, start: Date, end: Date, status = "confirmed"): CalendarEvent {
    return {
        id,
        slotId: `ss_${id}`,
        bookingId: id,
        start,
        end,
        title: "Groom",
        subtitle: "",
        status,
        staffId: "st_amy",
        clientId: "cl_ann",
        color: null,
        capacity: 1,
        bookedCount: 1,
        depositRequired: false,
        depositAmountCents: 0,
        depositStatus: "none",
    };
}

const avail = buildAvailability(
    [
        hours({ end_time: "12:00:00" }),
        hours({ start_time: "13:00:00" }),
        hours({ basis: "date", weekday: null, date: "2026-10-14", available: 0 }),
        hours({ basis: "date", weekday: null, date: "2026-11-04", start_time: "10:00:00" }),
    ],
    [
        {
            id: "av_vet",
            staff_id: "st_amy",
            starts_at: at(7, 14).toISOString(),
            ends_at: at(7, 15).toISOString(),
            reason: "Vet",
        },
        {
            id: "av_shut",
            staff_id: null,
            starts_at: at(21, 0).toISOString(),
            ends_at: at(22, 0).toISOString(),
            reason: "Inventory",
        },
    ],
);

const ctx = (events: CalendarEvent[] = [], now = at(1, 9)): Ctx => ({
    avail,
    events,
    staff: new Map([["st_amy", amy]]),
    now,
});

describe("stepDate", () => {
    it("steps weekly by whole weeks at the same local time", () => {
        expect(stepDate(at(7, 10), "week", 1, 0)).toEqual(at(7, 10));
        expect(stepDate(at(7, 10), "week", 2, 3)).toEqual(at(18, 10, 0, 10));
        expect(stepDate(at(28, 9, 30), "week", 1, 1)).toEqual(at(4, 9, 30, 10));
    });

    it("keeps the nth weekday monthly, and falls back to the last when a month is short", () => {
        expect(stepDate(at(7, 10), "month", 1, 1)).toEqual(at(4, 10, 0, 10));
        expect(stepDate(at(7, 10), "month", 1, 3)).toEqual(new Date(2027, 0, 6, 10));
        expect(stepDate(at(14, 10), "month", 2, 1)).toEqual(at(9, 10, 0, 11));
        expect(stepDate(at(29, 10), "month", 1, 1)).toEqual(at(26, 10, 0, 10));
        expect(stepDate(at(29, 10), "month", 1, 0)).toEqual(at(29, 10));
    });

    it("describes the pattern in words", () => {
        const day = at(7, 10).toLocaleDateString("en-CA", { weekday: "long" });
        expect(patternLabel("week", 2, at(7, 10))).toBe(
            s.patternWeekly(2, day, formatTime(at(7, 10))),
        );
        expect(patternLabel("month", 1, at(14, 10))).toBe(
            s.patternMonthly(1, s.ordinal(2), day, formatTime(at(14, 10))),
        );
        expect(patternLabel("month", 1, at(29, 10))).toContain(s.ordinal(5));
    });
});

describe("problemAt and suggest", () => {
    it("explains why a visit can't go at a time", () => {
        const c = ctx([visit("bk_1", at(7, 10), at(7, 11))]);
        const check = (start: Date, end: Date, ignore: (id: string) => boolean = none) =>
            problemAt(c, "st_amy", start, end, ignore);
        expect(check(at(21, 10), at(21, 11))).toBe(s.closed("Inventory"));
        expect(check(at(7, 14), at(7, 15))).toBe(s.away("Amy", "Vet"));
        expect(check(at(14, 10), at(14, 11))).toBe(s.notWorking("Amy", formatWeekday(at(14, 10))));
        expect(check(at(7, 11, 30), at(7, 12, 30))).toBe(s.outsideHours("Amy"));
        expect(check(at(7, 10, 30), at(7, 11, 30))).toBe(s.taken("Amy", formatTime(at(7, 10))));
        expect(check(at(7, 10, 30), at(7, 11, 30), (id) => id === "bk_1")).toBeNull();
        expect(check(at(7, 9), at(7, 10))).toBeNull();
    });

    it("names the live visit in the way, not a canceled or no-show one", () => {
        const c = ctx([
            visit("bk_gone", at(7, 9, 30), at(7, 10, 30), "canceled"),
            visit("bk_noshow", at(7, 9, 45), at(7, 10, 15), "no_show"),
            visit("bk_live", at(7, 10, 15), at(7, 11)),
        ]);
        expect(problemAt(c, "st_amy", at(7, 10), at(7, 11), none)).toBe(
            s.taken("Amy", formatTime(at(7, 10, 15))),
        );
        const onlyCanceled = ctx([visit("bk_gone", at(7, 10), at(7, 11), "canceled")]);
        expect(problemAt(onlyCanceled, "st_amy", at(7, 10), at(7, 11), none)).toBeNull();
    });

    it("suggests the nearest free time the same day, or nothing", () => {
        const c = ctx([visit("bk_1", at(7, 10), at(7, 11))]);
        expect(suggest(c, "st_amy", at(7, 10), 60, none)).toEqual(at(7, 11));
        const busy = ctx([visit("bk_1", at(7, 10), at(7, 12)), visit("bk_2", at(7, 9), at(7, 10))]);
        expect(suggest(busy, "st_amy", at(7, 10), 60, none)).toEqual(at(7, 13));
        expect(suggest(c, "st_amy", at(14, 10), 60, none)).toBeNull();
        expect(suggest(c, "st_amy", at(7, 23, 30), 60, none)).toBeNull();
    });
});

describe("buildOccurrences", () => {
    const pattern = {
        first: at(7, 10),
        frequency: "week" as const,
        interval: 1,
        end: "count" as const,
        count: 5,
        until: at(1, 0, 0, 11),
        staffId: "st_amy",
        durationMin: 60,
    };

    it("books each date, marks past ones done and offers a time for a clash", () => {
        const c = ctx([visit("bk_x", at(28, 10), at(28, 11))], at(7, 12));
        const dates = buildOccurrences(pattern, c);
        expect(dates.map((d) => [d.key, d.index, d.status, d.past])).toEqual([
            ["2026-10-07", 1, "done", true],
            ["2026-10-14", 2, "conflict", false],
            ["2026-10-21", 3, "conflict", false],
            ["2026-10-28", 4, "conflict", false],
            ["2026-11-04", 5, "booked", false],
        ]);
        expect(dates.map((d) => d.suggestion)).toEqual([null, null, null, at(28, 11), null]);
        expect(dates[0]?.problem).toBeNull();
        expect(dates[2]?.problem).toBe(s.closed("Inventory"));
        expect(dates[4]?.end).toEqual(at(4, 11, 0, 10));
        const ignored = buildOccurrences({ ...pattern, ignore: (id) => id === "bk_x" }, c);
        expect(ignored[3]?.status).toBe("booked");
    });

    it("stops at the end date, and caps an open series at sixty visits", () => {
        const until = buildOccurrences({ ...pattern, end: "until", until: at(21, 0) }, ctx());
        expect(until.map((d) => d.key)).toEqual(["2026-10-07", "2026-10-14", "2026-10-21"]);
        expect(buildOccurrences({ ...pattern, count: 500 }, ctx())).toHaveLength(60);
        expect(buildOccurrences({ ...pattern, count: 0 }, ctx())).toEqual([]);
    });
});

describe("a booked series", () => {
    const row: SeriesRow = {
        id: "sch_1",
        item_id: "it_groom",
        staff_id: "st_amy",
        client_id: "cl_ann",
        frequency: "week",
        interval: 1,
        count: 6,
        until: null,
        status: "active",
        item_name: "Groom",
        item_color: "#0af",
        duration_min: 60,
        deposit_type: "none",
        client_name: "Ann",
    };
    const seriesVisit = (id: string, start: Date, status: string | null, recurrence = "sch_1") => {
        const v: VisitRow = {
            slot_id: `ss_${id}`,
            recurrence_id: recurrence,
            starts_at: start.toISOString(),
            ends_at: new Date(start.getTime() + 3_600_000).toISOString(),
            staff_id: "st_amy",
            booking_id: status === null ? null : id,
            status,
            deposit_status: null,
            pet_name: null,
        };
        return v;
    };
    const visits = [
        seriesVisit("a", at(30, 10, 0, 8), "completed"),
        seriesVisit("b", at(7, 9), "confirmed"),
        seriesVisit("c", at(14, 10), "confirmed"),
        seriesVisit("d", at(21, 10), null),
        seriesVisit("e", at(28, 10), "no_show"),
        seriesVisit("f", at(4, 10, 0, 10), "confirmed"),
        seriesVisit("other", at(28, 11), "confirmed", "sch_2"),
    ];
    const now = at(7, 12);

    it("reads each date's state, checking only live future ones", () => {
        const dates = datesOf(row, visits, ctx([], now));
        expect(dates.map((d) => [d.key, d.index, d.status, d.past, d.bookingId])).toEqual([
            ["ss_a", 1, "done", true, "a"],
            ["ss_b", 2, "done", true, "b"],
            ["ss_c", 3, "conflict", false, "c"],
            ["ss_d", 4, "canceled", false, null],
            ["ss_e", 5, "missed", false, "e"],
            ["ss_f", 6, "booked", false, "f"],
        ]);
        expect(dates[2]?.problem).toBe(s.notWorking("Amy", formatWeekday(at(14, 10))));
        expect(dates[0]).toMatchObject({
            dateLabel: weekdayDay(at(30, 10, 0, 8)),
            timeLabel: formatTime(at(30, 10, 0, 8)),
        });
        expect(datesOf({ ...row, id: "sch_none" }, visits, ctx([], now))).toEqual([]);
    });

    it("summarizes progress, what's next, how many are left and what needs attention", () => {
        const dates = datesOf(row, visits, ctx([], now));
        const summary = summarize(row, dates, new Map([["st_amy", amy]]), now, "Rex");
        expect(summary).toMatchObject({
            id: "sch_1",
            clientName: "Ann",
            petName: "Rex",
            serviceName: "Groom",
            staffName: "Amy Lee",
            progress: s.progress(2, 5),
            ratio: 0.4,
            next: at(14, 10),
            nextLabel: `${weekdayDay(at(14, 10))}, ${formatTime(at(14, 10))}`,
            attention: 1,
            ending: false,
            status: "active",
        });
        expect(summary.endsLabel).toBe(
            s.endsOn(
                at(4, 10, 0, 10).toLocaleDateString("en-CA", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                }),
                3,
            ),
        );
        expect(summary.pattern).toBe(patternLabel("week", 1, at(14, 10)));
    });

    it("names today's visit, the last one left and an empty series", () => {
        const today = datesOf(row, [seriesVisit("t", at(7, 16), "confirmed")], ctx([], now));
        const one = summarize(row, today, new Map(), now, "");
        expect(one).toMatchObject({
            nextLabel: s.todayAt(formatTime(at(7, 16))),
            ending: true,
            ratio: 0,
            staffName: "",
        });
        const empty = summarize(row, [], new Map(), now, "");
        expect(empty).toMatchObject({
            next: null,
            nextLabel: s.noneLeft,
            endsLabel: s.noneLeft,
            ratio: null,
            progress: s.progress(0, 0),
            attention: 0,
        });
    });
});
