import { describe, expect, it } from "vitest";

import { addDays, formatTime, formatWeekday, zonedDate } from "../datetime";
import { strings } from "../strings";
import {
    type CalendarEvent,
    type ScheduleEvent,
    actorsFor,
    applyPending,
    arrivalLabel,
    blockSpan,
    buildAvailability,
    canCollectDeposit,
    composerTimes,
    depositOf,
    eventFlags,
    hourMarks,
    laneFor,
    layoutDay,
    lifecycleOf,
    markMoves,
    minuteTop,
    moveFailure,
    needsClosing,
    nextVisitStart,
    offHourSpans,
    openStarts,
    placeEvents,
    planMove,
    freeResources,
    settleMoves,
    shiftDay,
    slotProblem,
    upNext,
    visibleWindow,
    draftFollows,
    suggestedStart,
    toQuarterHour,
} from "./bookings";
import type { ItemRow } from "./catalog";
import type { StaffRow } from "./staff";
import { canCheckIn } from "./today";

const ZONE = "America/Vancouver";

const s = strings.bookings;

type HoursRow = Parameters<typeof buildAvailability>[0][number];
type AwayRow = Parameters<typeof buildAvailability>[1][number];
type Lane = Parameters<typeof offHourSpans>[0];

// Wednesday 7 October 2026, built in local time so the maths holds in any timezone.
const at = (h: number, m = 0, dayOffset = 0): Date =>
    zonedDate(2026, 10, 7 + dayOffset, h, m, ZONE);
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
        subjectName: null,
        staffName: "Amy Lee",
        staffShort: "Amy",
        staffColor: null,
        source: "staff",
        seriesId: null,
        bufferBeforeMin: 0,
        bufferAfterMin: 0,
        addonCount: 0,
        note: null,
        departedAt: null,
        checkedIn: false,
        bookedAt: null,
        remindedAt: null,
        intent: "accent",
        needsClose: false,
        needsMove: false,
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
const avail = buildAvailability(HOURS, AWAY, ZONE);

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
            layoutDay(events, { dayStart: DAY, zone: ZONE, pxPerMin: 1 }).map((p) => [
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
            ZONE,
        );
        expect(placed.map((p) => [p.event.id, p.top, p.height, p.leftPct])).toEqual([
            ["a", 120, 118, 0],
            ["b", 180, 58, 50],
        ]);
        expect(placeEvents([], DAY, 8, 2, ZONE)).toEqual([]);
    });

    it("places cards by wall clock on 23 and 25 hour days, as the hour lines are drawn", () => {
        const TOR = "America/Toronto";
        const on = (month: number, day: number, h: number, m = 0): Date =>
            zonedDate(2026, month, day, h, m, TOR);
        const top = (start: Date, end: Date, day: Date, startHour = 8) =>
            placeEvents([event("x", start, end)], day, startHour, 1, TOR).map((p) => [
                p.top,
                p.height,
            ]);
        expect(top(on(11, 1, 9), on(11, 1, 10), on(11, 1, 0))).toEqual([[60, 58]]);
        expect(minuteTop(on(11, 1, 9), 8, 1, TOR)).toBe(60);
        expect(top(on(3, 8, 9), on(3, 8, 10), on(3, 8, 0))).toEqual([[60, 58]]);
        expect(top(on(11, 1, 23), on(11, 2, 0), on(11, 1, 0), 0)).toEqual([[1380, 58]]);
        expect(top(on(3, 8, 23), on(3, 9, 1), on(3, 8, 0), 0)).toEqual([[1380, 58]]);
    });

    it("measures minutes, hour marks and the shaded hours outside a shift", () => {
        expect(minuteTop(at(9, 30), 8, 2, ZONE)).toBe(180);
        expect(minuteTop(at(7, 45), 8, 1, ZONE)).toBe(-15);
        expect(hourMarks(8, 12)).toEqual([8, 9, 10, 11]);
        expect(hourMarks(9, 9)).toEqual([]);
        const lane = (extra: Partial<Lane>): Lane => ({
            ...laneFor(member("st_bo", "Bo Chen"), DAY, [], avail),
            ...extra,
        });
        expect(offHourSpans(lane({ unset: true }), 8, 18, ZONE)).toEqual([]);
        expect(offHourSpans(lane({ unset: false, hours: null }), 8, 18, ZONE)).toEqual([
            { from: 0, to: 600 },
        ]);
        expect(
            offHourSpans(
                lane({ unset: false, hours: { start: at(9), end: at(17, 30) } }),
                8,
                18,
                ZONE,
            ),
        ).toEqual([
            { from: 0, to: 60 },
            { from: 570, to: 600 },
        ]);
        expect(
            offHourSpans(lane({ unset: false, hours: { start: at(8), end: at(18) } }), 8, 18, ZONE),
        ).toEqual([]);
    });
});

describe("buildAvailability", () => {
    it("reads a helper's block for a visit as a job tied to that booking", () => {
        const [job, away] = buildAvailability(
            HOURS,
            [
                {
                    id: "av_job",
                    staff_id: "st_amy",
                    starts_at: at(9).toISOString(),
                    ends_at: at(11).toISOString(),
                    reason: "Install · Owen",
                    note: "booking:bk_1",
                },
                { ...AWAY[0], id: "av_own", note: null } as AwayRow,
            ],
            ZONE,
        ).awayRows;
        expect([job?.kind, job?.bookingId, job?.label]).toEqual(["job", "bk_1", "Install · Owen"]);
        expect([away?.kind, away?.bookingId]).toEqual(["time_off", null]);
    });

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

    it("mirrors the server: buffers, other members, joining a class with seats and the same-day end", () => {
        const groom = { id: "it_groom", capacity: 1, bufferBeforeMin: 0, bufferAfterMin: 15 };
        const yoga = { id: "it_yoga", capacity: 4, bufferBeforeMin: 0, bufferAfterMin: 0 };
        const session = {
            kind: "class" as const,
            itemId: "it_yoga",
            bookingId: null,
            status: "scheduled",
        };
        const taken = [
            event("bk_1", at(10), at(11), { bufferAfterMin: 15 }),
            event("bk_bo", at(13), at(14), { staffId: "st_bo" }),
            event("cls", at(15), at(16), { ...session, capacity: 4, bookedCount: 3 }),
            event("full", at(16), at(17), { ...session, capacity: 2, bookedCount: 2 }),
        ];
        const check = (
            start: Date,
            end: Date,
            target: Parameters<typeof slotProblem>[7] = {},
            staff = "st_amy",
        ) => slotProblem(avail, taken, STAFF, staff, start, end, null, target);
        expect(check(at(11), at(11, 30)).problem).toBe("overlap");
        expect(check(at(11, 15), at(11, 45)).problem).toBeNull();
        expect(check(at(11, 15), at(11, 45), { item: { ...groom, bufferBeforeMin: 30 } })).toEqual({
            problem: "overlap",
            message: s.problemOverlap("Amy"),
        });
        expect(check(at(13, 30), at(14)).problem).toBeNull();
        expect(check(at(13, 30), at(14), {}, "st_bo").problem).toBe("overlap");
        expect(check(at(15), at(16), { item: yoga }).problem).toBeNull();
        expect(check(at(15), at(16), { item: groom }).problem).toBe("overlap");
        expect(check(at(16), at(17), { item: yoga })).toEqual({
            problem: "full",
            message: s.problemClassFull,
        });
        expect(check(at(22, 0, 14), at(23, 0, 14)).problem).toBeNull();
        expect(check(at(23, 0, 14), at(0, 0, 15)).problem).toBe("off_hours");
        expect(check(at(23), at(0, 0, 1), {}, "st_bo").problem).toBeNull();
    });

    it("snaps a drag to five minutes and says where it lands", () => {
        const visit = event("bk_1", at(10), at(11));
        const ctx = { avail, events: booked, staff: STAFF };
        const moved = planMove(visit, 32, "st_amy", ctx, at(8));
        expect([moved.start, moved.end, moved.problem]).toEqual([at(10, 30), at(11, 30), null]);
        expect(moved.message).toBe(
            s.dragTo(`${formatWeekday(at(10, 30), ZONE)} ${formatTime(at(10, 30), ZONE)}`, "Amy"),
        );
        expect(moved.label).toBe(
            `${formatTime(at(10, 30), ZONE)} – ${formatTime(at(11, 30), ZONE)}`,
        );
        expect(planMove(visit, 120, "st_amy", ctx, at(8)).problem).toBe("off_hours");
        expect(planMove(visit, -2, "st_amy", ctx, at(12)).problem).toBeNull();
        expect(planMove(visit, -30, "st_amy", ctx, at(12))).toMatchObject({
            problem: "past",
            message: s.problemPast,
        });
    });

    it("refuses a member the service doesn't name, except to keep a visit where it is", () => {
        const groom = { id: "it_groom", capacity: 1, bufferBeforeMin: 0, bufferAfterMin: 0 };
        const named = { item: { ...groom, staffIds: ["st_amy"] } };
        expect(slotProblem(avail, [], STAFF, "st_bo", at(6), at(7), null, named)).toEqual({
            problem: "not_offered",
            message: s.problemNotOffered("Bo"),
        });
        expect(slotProblem(avail, [], STAFF, "st_amy", at(9), at(10), null, named).problem).toBe(
            null,
        );
        const visit = event("bk_amy", at(10), at(11), { itemStaffIds: ["st_amy"] });
        const ctx = { avail, events: [visit], staff: STAFF };
        expect(planMove(visit, 0, "st_bo", ctx, at(8)).problem).toBe("not_offered");
        const kept = event("bk_bo", at(6), at(7), { staffId: "st_bo", itemStaffIds: ["st_amy"] });
        expect(
            planMove(kept, 15, "st_bo", { ...ctx, events: [kept] }, at(5), "resize").problem,
        ).toBeNull();
    });

    it("needs a free room from the pool, keeps the one a visit holds and ignores retired ones", () => {
        const massage = {
            id: "it_massage",
            capacity: 1,
            bufferBeforeMin: 0,
            bufferAfterMin: 15,
            resourceIds: ["rs_1", "rs_2"],
        };
        const busy = [
            event("bk_one", at(9), at(10), {
                staffId: "st_bo",
                resourceId: "rs_1",
                bufferAfterMin: 15,
            }),
            event("bk_two", at(9), at(10), {
                staffId: "st_cy",
                resourceId: "rs_2",
                bufferAfterMin: 15,
            }),
        ];
        const check = (start: Date, end: Date, target: Parameters<typeof slotProblem>[7]) =>
            slotProblem(avail, busy, STAFF, "st_amy", start, end, null, target);
        expect(check(at(9), at(10), { item: massage })).toEqual({
            problem: "resource",
            message: s.problemResource,
        });
        expect(check(at(10), at(11), { item: massage }).problem).toBe("resource");
        expect(check(at(10, 15), at(11, 15), { item: massage }).problem).toBeNull();
        expect(check(at(9), at(10), { item: { ...massage, resourceIds: [] } }).problem).toBeNull();
        const retired = { ...massage, resourceIds: [], needsResource: true };
        expect(check(at(10, 30), at(11, 30), { item: retired }).problem).toBe("resource");
        expect(
            freeResources(busy, ["rs_2", "rs_3", "rs_1"], massage, at(9), at(10), "bk_two"),
        ).toEqual(["rs_2", "rs_3"]);
        const visit = event("bk_amy", at(10, 15), at(11, 15), {
            resourceId: "rs_1",
            itemResourceIds: ["rs_1", "rs_2"],
        });
        const ctx = {
            avail,
            events: [visit, ...busy],
            staff: STAFF,
            rooms: [
                { id: "rs_1", name: "Room 1", active: 1 },
                { id: "rs_2", name: "Room 2", active: 0 },
            ],
        };
        expect(planMove(visit, -75, "st_amy", ctx, at(5)).problem).toBe("resource");
        expect(planMove(visit, 0, "st_amy", ctx, at(5)).problem).toBeNull();
    });

    it("resizes from the end and never below fifteen minutes", () => {
        const visit = event("bk_1", at(10), at(11));
        const ctx = { avail, events: booked, staff: STAFF };
        const shorter = planMove(visit, -50, "st_amy", ctx, at(12), "resize");
        expect([shorter.start, shorter.end]).toEqual([at(10), at(10, 15)]);
        expect(shorter.message).toBe(s.resizeTo(formatTime(at(10, 15), ZONE), 15));
        const longer = planMove(visit, 28, "st_amy", ctx, at(12), "resize");
        expect([longer.end, longer.problem]).toEqual([at(11, 30), null]);
    });
});

describe("the day board", () => {
    it("shows a pending move before sync brings it back", () => {
        const events = [event("a", at(9), at(10)), event("b", at(11), at(12))];
        expect(applyPending(events, {}, ZONE)).toBe(events);
        const moved = applyPending(
            events,
            {
                b: { start: at(14), end: at(15), staffId: "st_bo" },
            },
            ZONE,
        );
        expect(moved[0]).toBe(events[0]);
        expect(moved[1]).toMatchObject({
            start: at(14),
            end: at(15),
            staffId: "st_bo",
            timeLabel: `${formatTime(at(14), ZONE)} – ${formatTime(at(15), ZONE)}`,
        });
    });

    it("keeps a moved visit where it was dropped until the replica brings it back", () => {
        const events = [event("a", at(9), at(10)), event("b", at(11), at(12))];
        const pending = {
            a: { start: at(13), end: at(14), staffId: "st_amy" },
            b: { start: at(15), end: at(16), staffId: "st_amy" },
        };
        expect(settleMoves(pending, events)).toBe(pending);
        const arrived = [event("a", at(13), at(14)), event("b", at(11), at(12))];
        expect(settleMoves(pending, arrived)).toEqual({ b: pending.b });
        expect(settleMoves({}, arrived)).toEqual({});
    });

    it("drops a pending move when the visit leaves the visible replica window", () => {
        expect(settleMoves({ a: { start: at(13), end: at(14), staffId: "st_amy" } }, [])).toEqual(
            {},
        );
    });

    it("says a move failed for want of a connection, not because the time was taken", () => {
        expect(moveFailure(new TypeError("Failed to fetch"))).toBe(s.moveOffline);
        expect(moveFailure(Object.assign(new Error("409"), { status: 409 }))).toBe(
            s.rescheduleError,
        );
        expect(
            moveFailure(Object.assign(new Error("409"), { status: 409, code: "class_move" })),
        ).toBe(strings.api.classMove);
    });

    it("clamps a block to the visible window and widens the window to midnight", () => {
        const block = (start: Date, end: Date) => ({
            id: "b",
            staffId: "st_amy",
            start,
            end,
            kind: "time_off" as const,
            label: "Vet",
        });
        expect(blockSpan(block(at(7), at(10)), DAY, 8, 18, 1, ZONE)).toEqual({
            top: 0,
            height: 120,
        });
        expect(blockSpan(block(at(17), at(9, 0, 1)), DAY, 8, 18, 1, ZONE)).toEqual({
            top: 540,
            height: 60,
        });
        expect(blockSpan(block(at(5), at(7)), DAY, 8, 18, 1, ZONE)).toBeNull();
        expect(visibleWindow(DAY, [{ start: at(9), end: at(17, 30) }], ZONE)).toEqual({
            startHour: 9,
            endHour: 18,
        });
        expect(visibleWindow(DAY, [{ start: at(22), end: at(0, 0, 1) }], ZONE)).toEqual({
            startHour: 22,
            endHour: 24,
        });
        expect(visibleWindow(DAY, [{ start: at(23, 0, -1), end: at(1) }], ZONE)).toEqual({
            startHour: 0,
            endHour: 1,
        });
        expect(visibleWindow(DAY, [], ZONE)).toEqual({ startHour: 9, endHour: 17 });
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
            hoursLabel: "9:00 a.m. – 5:00 p.m.",
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
        const dayOff = laneFor(member("st_amy", "Amy Lee"), addDays(DAY, 7, ZONE), [], avail);
        expect(dayOff).toMatchObject({ unset: false, hours: null, hoursLabel: s.offToday });
        const closed = laneFor(member("st_bo", "Bo Chen"), addDays(DAY, 5, ZONE), [], avail);
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

    it("marks open visits a closure or time off now covers as needing a new time", () => {
        const events = [
            event("shut", at(10, 0, 5), at(11, 0, 5)),
            event("shut_done", at(12, 0, 5), at(13, 0, 5), { status: "completed" }),
            event("vet", at(14, 30), at(15)),
            event("fine", at(10), at(11)),
            event("bo", at(14), at(15), { staffId: "st_bo" }),
        ];
        const marked = markMoves(events, avail.away, at(8));
        expect(marked.filter((e) => e.needsMove).map((e) => e.id)).toEqual(["shut", "vet"]);
        expect(marked[3]).toBe(events[3]);
        expect(markMoves(events, avail.away, at(16)).filter((e) => e.needsMove)).toHaveLength(1);
        expect(
            eventFlags(event("a", at(9), at(10), { needsMove: true, seriesId: "sch_1" })),
        ).toEqual(["needs_move", "recurring"]);
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

describe("picking a time", () => {
    it("offers every quarter hour that fits the member's hours, or the visible window", () => {
        const window = { startHour: 7, endHour: 10 };
        expect(openStarts(avail, "st_bo", DAY, 60, window).map((d) => formatTime(d, ZONE))).toEqual(
            [
                "7:00 a.m.",
                "7:15 a.m.",
                "7:30 a.m.",
                "7:45 a.m.",
                "8:00 a.m.",
                "8:15 a.m.",
                "8:30 a.m.",
                "8:45 a.m.",
                "9:00 a.m.",
            ],
        );
        const amy = openStarts(avail, "st_amy", DAY, 120, window);
        expect([amy[0], amy.at(-1), amy.length]).toEqual([at(9), at(15), 14]);
        expect(openStarts(avail, "st_amy", at(0, 0, 7), 60, window)).toEqual([]);
    });

    it("lists composer start times across the visible window and the usual day", () => {
        const keys = (w: { startHour: number; endHour: number }) =>
            composerTimes(w).map((o) => o.key);
        expect(keys({ startHour: 9, endHour: 17 }).slice(0, 2)).toEqual(["06:00", "06:15"]);
        expect(keys({ startHour: 9, endHour: 17 }).at(-1)).toBe("21:45");
        expect(keys({ startHour: 5, endHour: 24 })[0]).toBe("05:00");
        expect(keys({ startHour: 5, endHour: 24 }).at(-1)).toBe("23:45");
    });

    it("keeps the chosen weekday when the week changes, never before today", () => {
        expect(shiftDay("2026-10-07", 1, ZONE, at(8))).toBe("2026-10-14");
        expect(shiftDay("2026-10-14", -1, ZONE, at(8))).toBe("2026-10-07");
        expect(shiftDay("2026-10-14", -1, ZONE, at(8, 0, 2))).toBe("2026-10-09");
    });

    it("offers staff only themselves and a manager everyone", () => {
        const rows = [...STAFF.values()];
        const ids = (viewer: Parameters<typeof actorsFor>[1]) =>
            actorsFor(rows, viewer).map((x) => x.id);
        expect(ids({ role: "owner", staffId: "st_amy" })).toEqual(["st_amy", "st_bo"]);
        expect(ids({ role: "admin", staffId: "st_amy" })).toEqual(["st_amy", "st_bo"]);
        expect(ids({ role: "staff", staffId: "st_bo" })).toEqual(["st_bo"]);
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

describe("closing a visit", () => {
    it("shows Complete and No-show disabled with the reason until the visit starts", () => {
        const ahead = lifecycleOf(event("a", at(10), at(11)), at(9, 59));
        expect(ahead).toEqual({
            canComplete: false,
            canNoShow: false,
            canCancel: true,
            canReschedule: true,
            notStartedNote: s.notStartedNote,
        });
        const started = lifecycleOf(event("a", at(10), at(11)), at(10));
        expect(started).toMatchObject({ canComplete: true, canNoShow: true, canCancel: false });
        expect(started.notStartedNote).toBeNull();
    });

    it("offers nothing on a visit that is already closed", () => {
        const closed = lifecycleOf(event("a", at(10), at(11), { status: "completed" }), at(9));
        expect(closed.notStartedNote).toBeNull();
        expect(closed.canComplete || closed.canCancel).toBe(false);
    });
});

describe("arrivalLabel", () => {
    const start = zonedDate(2026, 10, 7, 10, 0, "America/Vancouver");
    const end = zonedDate(2026, 10, 7, 11, 0, "America/Vancouver");
    const left = new Date(start.getTime() - 20 * 60_000);

    it("says a visit to a place is on the way, then arrived, and says nothing for other kinds", () => {
        expect(arrivalLabel(event("a", start, end), "site")).toBeNull();
        expect(arrivalLabel(event("b", start, end, { departedAt: left }), "site")).toBe(
            strings.bookings.onTheWay,
        );
        const here = event("c", start, end, { departedAt: left, checkedIn: true });
        expect(arrivalLabel(here, "site")).toBe(strings.bookings.arrivedOnSite);
        expect(arrivalLabel(here, "property")).toBe(strings.bookings.arrivedAtPlace);
        expect(arrivalLabel(here, "vehicle")).toBe(strings.bookings.arrivedAtPlace);
        expect(arrivalLabel(here, "pet")).toBeNull();
    });
});

describe("canCheckIn", () => {
    const staff = { staffId: "st_amy", role: "staff" as const };
    const visit = event("bk_1", at(10), at(11));

    it("opens on the visit's day until it ends, for its member or a manager", () => {
        expect(canCheckIn(visit, staff, "pet", ZONE, at(9))).toBe(true);
        expect(canCheckIn(visit, { staffId: "st_x", role: "owner" }, "pet", ZONE, at(9))).toBe(
            true,
        );
        expect(canCheckIn(visit, { staffId: "st_bo", role: "staff" }, "pet", ZONE, at(9))).toBe(
            false,
        );
        expect(canCheckIn(visit, null, "pet", ZONE, at(9))).toBe(false);
        expect(canCheckIn(visit, staff, "pet", ZONE, at(11, 30))).toBe(false);
        expect(canCheckIn(visit, staff, "pet", ZONE, at(9, 0, -1))).toBe(false);
    });

    it("skips classes, closed and already checked-in visits", () => {
        expect(
            canCheckIn(event("c", at(10), at(11), { kind: "class" }), staff, "pet", ZONE, at(9)),
        ).toBe(false);
        expect(
            canCheckIn(
                event("d", at(10), at(11), { status: "canceled" }),
                staff,
                "pet",
                ZONE,
                at(9),
            ),
        ).toBe(false);
        expect(
            canCheckIn(event("e", at(10), at(11), { checkedIn: true }), staff, "pet", ZONE, at(9)),
        ).toBe(false);
    });

    it("waits for On my way when the business goes to the client", () => {
        expect(canCheckIn(visit, staff, "site", ZONE, at(9))).toBe(false);
        const left = event("f", at(10), at(11), { departedAt: at(9) });
        expect(canCheckIn(left, staff, "site", ZONE, at(9, 30))).toBe(true);
        expect(canCheckIn(visit, staff, "vehicle", ZONE, at(9))).toBe(false);
        expect(canCheckIn(left, staff, "vehicle", ZONE, at(9, 30))).toBe(true);
    });
});

describe("nextVisitStart", () => {
    it("follows the series, else the client's own gap, else suggests nothing", () => {
        const start = at(10);
        expect(nextVisitStart(start, null, { frequency: "week", interval: 6 }, ZONE)).toEqual(
            at(10, 0, 42),
        );
        expect(nextVisitStart(start, at(10, 0, -28), null, ZONE)).toEqual(at(10, 0, 28));
        expect(nextVisitStart(start, null, null, ZONE)).toBeNull();
        expect(nextVisitStart(start, at(9), null, ZONE)).toBeNull();
    });
});

describe("draftFollows", () => {
    it("moves nothing while the form and the board show the same day", () => {
        expect(draftFollows(null, "2026-10-23", "2026-10-23")).toBeNull();
        expect(
            draftFollows({ focus: "2026-10-23", day: "2026-10-23" }, "2026-10-23", "2026-10-23"),
        ).toBeNull();
    });

    it("takes the board to a booking that opens on another day, as a rebook does", () => {
        expect(draftFollows(null, "2026-11-20", "2026-10-23")).toBe("board");
    });

    it("takes the board to the day picked in the form", () => {
        expect(
            draftFollows({ focus: "2026-10-23", day: "2026-10-23" }, "2026-10-24", "2026-10-23"),
        ).toBe("board");
    });

    it("carries the draft to the day the board pages to", () => {
        expect(
            draftFollows({ focus: "2026-10-23", day: "2026-10-23" }, "2026-10-23", "2026-10-24"),
        ).toBe("form");
    });
});

describe("toQuarterHour", () => {
    it("rounds to the nearest quarter hour", () => {
        expect(toQuarterHour(new Date("2026-10-23T17:07:00Z")).toISOString()).toBe(
            "2026-10-23T17:00:00.000Z",
        );
        expect(toQuarterHour(new Date("2026-10-23T17:08:00Z")).toISOString()).toBe(
            "2026-10-23T17:15:00.000Z",
        );
    });
});

describe("suggestedStart", () => {
    const zone = "America/Vancouver";
    const now = new Date("2026-10-21T17:02:00Z");

    it("offers the next quarter hour on today", () => {
        expect(suggestedStart(now, now, zone).toISOString()).toBe("2026-10-21T17:15:00.000Z");
    });

    it("offers ten in the morning on another day", () => {
        expect(suggestedStart(addDays(now, 1, zone), now, zone).toISOString()).toBe(
            "2026-10-22T17:00:00.000Z",
        );
    });
});
