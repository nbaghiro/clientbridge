import { describe, expect, it } from "vitest";

import { addDays, formatTime, formatWeekday } from "../datetime";
import { strings } from "../strings";
import {
    type CalendarEvent,
    type ScheduleEvent,
    applyPending,
    buildAvailability,
    canCollectDeposit,
    depositOf,
    eventFlags,
    hourMarks,
    laneFor,
    layoutDay,
    minuteTop,
    needsClosing,
    offHourSpans,
    placeEvents,
    planMove,
    slotProblem,
    upNext,
} from "./bookings";
import type { ItemRow } from "./catalog";
import type { StaffRow } from "./staff";

const s = strings.bookings;

type HoursRow = Parameters<typeof buildAvailability>[0][number];
type AwayRow = Parameters<typeof buildAvailability>[1][number];
type Lane = Parameters<typeof offHourSpans>[0];

// Wednesday 7 October 2026, built in local time so the maths holds in any timezone.
const at = (h: number, m = 0, dayOffset = 0): Date => new Date(2026, 9, 7 + dayOffset, h, m);
const DAY = at(0);

function event(id: string, start: Date, end: Date, extra: Partial<ScheduleEvent> = {}) {
    const e: ScheduleEvent = {
        id,
        slotId: `ss_${id}`,
        bookingId: id,
        start,
        end,
        title: "Groom",
        subtitle: "Ann",
        status: "confirmed",
        staffId: "st_amy",
        clientId: "cl_ann",
        color: null,
        capacity: 1,
        bookedCount: 1,
        depositRequired: false,
        depositAmountCents: 0,
        depositStatus: "none",
        kind: "visit",
        itemId: "it_groom",
        priceCents: 7500,
        serviceName: "Groom",
        clientName: "Ann",
        petName: null,
        staffName: "Amy Lee",
        staffShort: "Amy",
        staffColor: null,
        source: "staff",
        seriesId: null,
        resourceId: null,
        resourceName: null,
        addonCount: 0,
        note: null,
        checkedIn: false,
        bookedAt: null,
        remindedAt: null,
        intent: "accent",
        needsClose: false,
        inProgress: false,
        timeLabel: "",
        timeShort: "",
        headline: "Ann",
        ...extra,
    };
    return e;
}

const member = (id: string, name: string): StaffRow => ({
    id,
    user_id: null,
    name,
    title: null,
    role: "staff",
    color: "#0af",
    status: "active",
    invite_email: null,
});
const STAFF = new Map([
    ["st_amy", member("st_amy", "Amy Lee")],
    ["st_bo", member("st_bo", "Bo Chen")],
]);

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

const HOURS: HoursRow[] = [
    hours({ end_time: "12:00:00" }),
    hours({ start_time: "13:00:00" }),
    hours({ basis: "date", weekday: null, date: "2026-10-14", available: 0 }),
    hours({
        basis: "date",
        weekday: null,
        date: "2026-10-21",
        start_time: "10:00:00",
        end_time: null,
    }),
];
const AWAY: AwayRow[] = [
    {
        id: "av_vet",
        staff_id: "st_amy",
        starts_at: at(14).toISOString(),
        ends_at: at(15).toISOString(),
        reason: "Vet",
    },
    {
        id: "av_shut",
        staff_id: null,
        starts_at: at(0, 0, 5).toISOString(),
        ends_at: at(0, 0, 6).toISOString(),
        reason: "Thanksgiving",
    },
];
const avail = buildAvailability(HOURS, AWAY);

describe("layoutDay", () => {
    it("puts overlapping visits side by side and reuses a column once it frees up", () => {
        const events: CalendarEvent[] = [
            event("c", at(10), at(11)),
            event("a", at(9), at(10)),
            event("b", at(9, 30), at(10, 30)),
            event("d", at(13), at(13, 10)),
            event("late", at(23), at(1, 0, 1)),
            event("yesterday", at(9, 0, -1), at(10, 0, -1)),
        ];
        expect(
            layoutDay(events, { dayStart: DAY, pxPerMin: 1 }).map((p) => [
                p.event.id,
                p.topPx,
                p.heightPx,
                p.leftPct,
                p.widthPct,
            ]),
        ).toEqual([
            ["a", 540, 59, 0, 50],
            ["b", 570, 59, 50, 50],
            ["c", 600, 59, 0, 50],
            ["d", 780, 18, 0, 100],
            ["late", 1380, 59, 0, 100],
        ]);
    });

    it("places a lane's visits from the top of the visible window", () => {
        const placed = placeEvents(
            [event("a", at(9), at(10)), event("b", at(9, 30), at(10))],
            DAY,
            8,
            2,
        );
        expect(placed.map((p) => [p.event.id, p.top, p.height, p.leftPct])).toEqual([
            ["a", 120, 118, 0],
            ["b", 180, 58, 50],
        ]);
        expect(placeEvents([], DAY, 8, 2)).toEqual([]);
    });

    it("measures minutes, hour marks and the shaded hours outside a shift", () => {
        expect(minuteTop(at(9, 30), 8, 2)).toBe(180);
        expect(minuteTop(at(7, 45), 8, 1)).toBe(-15);
        expect(hourMarks(8, 12)).toEqual([8, 9, 10, 11]);
        expect(hourMarks(9, 9)).toEqual([]);
        const lane = (extra: Partial<Lane>): Lane => ({
            ...laneFor(member("st_bo", "Bo Chen"), DAY, [], avail),
            ...extra,
        });
        expect(offHourSpans(lane({ unset: true }), 8, 18)).toEqual([]);
        expect(offHourSpans(lane({ unset: false, hours: null }), 8, 18)).toEqual([
            { from: 0, to: 600 },
        ]);
        expect(
            offHourSpans(lane({ unset: false, hours: { start: at(9), end: at(17, 30) } }), 8, 18),
        ).toEqual([
            { from: 0, to: 60 },
            { from: 570, to: 600 },
        ]);
        expect(
            offHourSpans(lane({ unset: false, hours: { start: at(8), end: at(18) } }), 8, 18),
        ).toEqual([]);
    });
});

describe("buildAvailability", () => {
    it("reads split recurring hours, a dated day off and a dated open-ended day", () => {
        expect(avail.windows("st_amy", DAY)).toEqual([
            { start: at(9), end: at(12) },
            { start: at(13), end: at(17) },
        ]);
        expect(avail.hours("st_amy", DAY)).toEqual({ start: at(9), end: at(17) });
        expect(avail.windows("st_amy", at(0, 0, 7))).toEqual([]);
        expect(avail.hours("st_amy", at(0, 0, 7))).toBeNull();
        expect(avail.windows("st_amy", at(0, 0, 14))).toEqual([
            { start: at(10, 0, 14), end: at(0, 0, 15) },
        ]);
        expect(avail.windows("st_amy", at(0, 0, 1))).toBeNull();
        expect(avail.windows("st_bo", DAY)).toBeNull();
    });

    it("finds breaks between shifts, time off and whole-day closures", () => {
        expect(avail.blocks(DAY).map((b) => [b.id, b.kind, b.start, b.end, b.label])).toEqual([
            ["av_vet", "time_off", at(14), at(15), "Vet"],
            ["break_st_amy_1", "break", at(12), at(13), s.breakLabel],
        ]);
        expect(avail.away("st_amy", at(14, 30), at(15, 30))?.id).toBe("av_vet");
        expect(avail.away("st_amy", at(15), at(16))).toBeNull();
        expect(avail.away("st_bo", at(14), at(15))).toBeNull();
        expect(avail.away("st_bo", at(10, 0, 5), at(11, 0, 5))?.id).toBe("av_shut");
        expect(avail.isClosed(at(12, 0, 5))?.label).toBe("Thanksgiving");
        expect(avail.isClosed(DAY)).toBeNull();
    });
});

describe("slotProblem and planMove", () => {
    const booked = [
        event("bk_1", at(10), at(11)),
        event("bk_gone", at(15), at(16), { status: "canceled" }),
        event("bk_bo", at(11), at(12), { staffId: "st_bo" }),
    ];

    it("checks closure, time off, hours and overlap in the server's order", () => {
        const check = (start: Date, end: Date, ignore: string | null = null, staff = "st_amy") =>
            slotProblem(avail, booked, STAFF, staff, start, end, ignore);
        expect(check(at(10, 0, 5), at(11, 0, 5))).toEqual({
            problem: "closed",
            message: s.problemClosed("Thanksgiving"),
        });
        expect(check(at(14), at(14, 30))).toEqual({
            problem: "time_off",
            message: s.problemTimeOff("Amy", "Vet"),
        });
        expect(check(at(11, 30), at(12, 30))).toEqual({
            problem: "off_hours",
            message: s.problemOffHours("Amy"),
        });
        expect(check(at(10, 30), at(11, 30))).toEqual({
            problem: "overlap",
            message: s.problemOverlap("Amy"),
        });
        expect(check(at(10, 30), at(11, 30), "bk_1").problem).toBeNull();
        expect(check(at(15), at(16)).problem).toBeNull();
        expect(check(at(11), at(12)).problem).toBeNull();
        expect(check(at(6), at(7), null, "st_bo").problem).toBeNull();
    });

    it("snaps a drag to five minutes and says where it lands", () => {
        const visit = event("bk_1", at(10), at(11));
        const ctx = { avail, events: booked, staff: STAFF };
        const moved = planMove(visit, 32, "st_amy", ctx, at(8));
        expect([moved.start, moved.end, moved.problem]).toEqual([at(10, 30), at(11, 30), null]);
        expect(moved.message).toBe(
            s.dragTo(`${formatWeekday(at(10, 30))} ${formatTime(at(10, 30))}`, "Amy"),
        );
        expect(moved.label).toBe(`${formatTime(at(10, 30))} – ${formatTime(at(11, 30))}`);
        expect(planMove(visit, 120, "st_amy", ctx, at(8)).problem).toBe("off_hours");
        expect(planMove(visit, -2, "st_amy", ctx, at(12)).problem).toBeNull();
        expect(planMove(visit, -30, "st_amy", ctx, at(12))).toMatchObject({
            problem: "past",
            message: s.problemPast,
        });
    });

    it("resizes from the end and never below fifteen minutes", () => {
        const visit = event("bk_1", at(10), at(11));
        const ctx = { avail, events: booked, staff: STAFF };
        const shorter = planMove(visit, -50, "st_amy", ctx, at(12), "resize");
        expect([shorter.start, shorter.end]).toEqual([at(10), at(10, 15)]);
        expect(shorter.message).toBe(s.resizeTo(formatTime(at(10, 15)), 15));
        const longer = planMove(visit, 28, "st_amy", ctx, at(12), "resize");
        expect([longer.end, longer.problem]).toEqual([at(11, 30), null]);
    });
});

describe("the day board", () => {
    it("shows a pending move before sync brings it back", () => {
        const events = [event("a", at(9), at(10)), event("b", at(11), at(12))];
        expect(applyPending(events, {})).toBe(events);
        const moved = applyPending(events, {
            b: { start: at(14), end: at(15), staffId: "st_bo" },
        });
        expect(moved[0]).toBe(events[0]);
        expect(moved[1]).toMatchObject({
            start: at(14),
            end: at(15),
            staffId: "st_bo",
            timeLabel: `${formatTime(at(14))} – ${formatTime(at(15))}`,
        });
    });

    it("builds a lane's hours, time booked and what is left after breaks and time off", () => {
        const events = [
            event("a", at(10), at(11)),
            event("b", at(9, 30), at(10)),
            event("bo", at(9), at(10), { staffId: "st_bo" }),
            event("tomorrow", at(9, 0, 1), at(10, 0, 1)),
        ];
        const lane = laneFor(member("st_amy", "Amy Lee"), DAY, events, avail);
        expect(lane).toMatchObject({
            short: "Amy",
            initials: "AL",
            hours: { start: at(9), end: at(17) },
            unset: false,
            hoursLabel: s.hoursRange(formatTime(at(9)), formatTime(at(17))),
            bookedMin: 90,
            availableMin: 360,
            utilization: 0.25,
        });
        expect(lane.events.map((e) => e.id)).toEqual(["a", "b"]);
        expect(lane.blocks.map((b) => b.kind)).toEqual(["time_off", "break"]);

        const unset = laneFor(member("st_bo", "Bo Chen"), DAY, events, avail);
        expect(unset).toMatchObject({
            unset: true,
            hours: null,
            hoursLabel: s.noHoursSet,
            availableMin: 0,
            utilization: 0,
        });
        const dayOff = laneFor(member("st_amy", "Amy Lee"), addDays(DAY, 7), [], avail);
        expect(dayOff).toMatchObject({ unset: false, hours: null, hoursLabel: s.offToday });
        const closed = laneFor(member("st_bo", "Bo Chen"), addDays(DAY, 5), [], avail);
        expect(closed).toMatchObject({ unset: false, hours: null, hoursLabel: s.offToday });
    });

    it("flags deposits due, series, online bookings, add-ons, notes and classes", () => {
        expect(eventFlags(event("a", at(9), at(10)))).toEqual([]);
        expect(
            eventFlags(
                event("a", at(9), at(10), {
                    depositRequired: true,
                    depositStatus: "pending",
                    seriesId: "sch_1",
                    source: "online",
                    addonCount: 2,
                    note: "Nervous",
                }),
            ),
        ).toEqual(["deposit_due", "recurring", "online", "addons", "note"]);
        expect(
            eventFlags(
                event("a", at(9), at(10), {
                    kind: "class",
                    depositRequired: true,
                    depositStatus: "pending",
                    status: "completed",
                }),
            ),
        ).toEqual(["class"]);
        expect(
            eventFlags(
                event("a", at(9), at(10), { depositRequired: true, depositStatus: "collected" }),
            ),
        ).toEqual([]);
    });

    it("lists visits to close and the next few booked ones", () => {
        const events = [
            event("done", at(8), at(9), { needsClose: true }),
            event("now", at(9), at(11), { needsClose: false }),
            event("soon", at(12), at(13)),
            event("pending", at(13), at(14), { status: "pending" }),
            event("canceled", at(14), at(15), { status: "canceled" }),
            event("later", at(15), at(16)),
            event("last", at(16), at(17)),
        ];
        expect(needsClosing(events).map((e) => e.id)).toEqual(["done"]);
        expect(upNext(events, at(10)).map((e) => e.id)).toEqual(["soon", "pending", "later"]);
        expect(upNext(events, at(10), 1).map((e) => e.id)).toEqual(["soon"]);
        expect(upNext(events, at(16))).toEqual([]);
    });
});

describe("deposits", () => {
    const item = (extra: Partial<ItemRow>): ItemRow =>
        ({
            id: "it_groom",
            kind: "service",
            price_cents: 7500,
            deposit_type: "none",
            deposit_value: null,
            ...extra,
        }) as ItemRow;

    it("takes a fixed amount or a percent of the price, rounded to the cent", () => {
        expect(depositOf(null)).toBe(0);
        expect(depositOf(item({}))).toBe(0);
        expect(depositOf(item({ deposit_type: "fixed", deposit_value: 2000 }))).toBe(2000);
        expect(depositOf(item({ deposit_type: "percent", deposit_value: 25 }))).toBe(1875);
        expect(
            depositOf(item({ deposit_type: "percent", deposit_value: 33, price_cents: 1001 })),
        ).toBe(330);
        expect(
            depositOf(item({ deposit_type: "percent", deposit_value: 50, price_cents: null })),
        ).toBe(0);
        expect(depositOf(item({ deposit_type: "fixed", deposit_value: null }))).toBe(0);
    });

    it("lets a manager or the visit's own staff collect a deposit still due", () => {
        const due = event("bk_1", at(9), at(10), {
            depositRequired: true,
            depositAmountCents: 2000,
            depositStatus: "pending",
        });
        expect(canCollectDeposit(due, { staffId: "st_owner", role: "owner" })).toBe(true);
        expect(canCollectDeposit(due, { staffId: "st_x", role: "admin" })).toBe(true);
        expect(canCollectDeposit(due, { staffId: "st_amy", role: "staff" })).toBe(true);
        expect(canCollectDeposit(due, { staffId: "st_bo", role: "staff" })).toBe(false);
        expect(canCollectDeposit(due, null)).toBe(false);
        const owner = { staffId: "st_owner", role: "owner" };
        expect(canCollectDeposit({ ...due, depositStatus: "collected" }, owner)).toBe(false);
        expect(canCollectDeposit({ ...due, bookingId: null }, owner)).toBe(false);
        expect(canCollectDeposit({ ...due, depositRequired: false }, owner)).toBe(false);
    });
});
