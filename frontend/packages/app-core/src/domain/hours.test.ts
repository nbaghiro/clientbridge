import { describe, expect, it } from "vitest";

import { formatShortDayTime, formatTime, zonedDate } from "../datetime";
import { formatList, formatParts } from "../format";
import type { ScheduleEvent } from "./bookings";
import { strings } from "../strings";
import {
    affectedBy,
    rebaseWeek,
    refusalMessage,
    seedDays,
    shiftLabel,
    splitNote,
    strandedNote,
    withinHours,
} from "./hours";

const s = strings.hours;

const ZONE = "America/Vancouver";

type RecurringRow = Parameters<typeof seedDays>[0][number];

const row = (weekday: number, start: string, end: string, available = 1): RecurringRow => ({
    weekday,
    start_time: start,
    end_time: end,
    available,
});

describe("the weekly hours editor", () => {
    it("defaults days without rows to weekdays nine to five, weekends closed", () => {
        expect(seedDays([])).toEqual([
            { weekday: 0, open: true, start: "09:00", end: "17:00", split: false },
            { weekday: 1, open: true, start: "09:00", end: "17:00", split: false },
            { weekday: 2, open: true, start: "09:00", end: "17:00", split: false },
            { weekday: 3, open: true, start: "09:00", end: "17:00", split: false },
            { weekday: 4, open: true, start: "09:00", end: "17:00", split: false },
            { weekday: 5, open: false, start: "09:00", end: "17:00", split: false },
            { weekday: 6, open: false, start: "09:00", end: "17:00", split: false },
        ]);
    });

    it("marks a split day instead of flattening it, and keeps a closed day closed", () => {
        const days = seedDays([
            row(1, "08:30:00", "12:00:00"),
            row(1, "13:00:00", "18:15:00"),
            row(3, "09:00:00", "17:00:00", 0),
            row(5, "10:00:00", "14:00:00"),
        ]);
        expect(days[1]).toEqual({
            weekday: 1,
            open: true,
            start: "08:30",
            end: "18:15",
            split: true,
        });
        expect(days[3]).toEqual({
            weekday: 3,
            open: false,
            start: "09:00",
            end: "17:00",
            split: false,
        });
        expect(days[5]).toEqual({
            weekday: 5,
            open: true,
            start: "10:00",
            end: "14:00",
            split: false,
        });
        expect(days[0]?.open).toBe(true);
        expect(days[6]?.open).toBe(false);
    });

    it("explains that split days can't be changed here and names each refusal", () => {
        const split = seedDays([
            row(1, "08:30:00", "12:00:00"),
            row(1, "13:00:00", "18:15:00"),
            row(4, "09:00:00", "11:00:00"),
            row(4, "12:00:00", "17:00:00"),
        ]);
        expect(splitNote(split)).toBe(s.splitWeek(`${s.tuesday} and ${s.friday}`, 2));
        expect(splitNote(seedDays([row(1, "09:00:00", "17:00:00")]))).toBeNull();
        expect(refusalMessage("hours_split_week")).toBe(s.splitRefused);
        expect(refusalMessage("hours_revision_conflict")).toBe(s.conflict);
        expect(refusalMessage("http_422")).toBe(s.refused);
    });

    it("labels a shift in full or as a short twelve-hour span", () => {
        const t = (h: number, m = 0) => formatTime(zonedDate(2000, 1, 1, h, m, ZONE), ZONE);
        expect(shiftLabel("09:00", "17:00")).toBe(`${t(9)} – ${t(17)}`);
        expect(shiftLabel("09:00", "17:00", true)).toBe("9–5");
        expect(shiftLabel("08:30", "12:00", true)).toBe("8:30–12");
        expect(shiftLabel("00:00", "13:05", true)).toBe("12–1:05");
    });
});

describe("affectedBy", () => {
    const at = (h: number, day = 7) => zonedDate(2026, 10, day, h, 0, ZONE);
    const visit = (id: string, staffId: string, start: Date, end: Date, status = "confirmed") =>
        ({ id, staffId, start, end, status }) as ScheduleEvent;
    const events = [
        visit("a", "st_amy", at(9), at(10)),
        visit("b", "st_amy", at(14), at(15), "pending"),
        visit("c", "st_amy", at(14), at(15), "canceled"),
        visit("d", "st_bo", at(14), at(15)),
        visit("e", "st_amy", at(15), at(16)),
        visit("f", "st_amy", at(9, 8), at(10, 8)),
    ];

    it("lists the live visits time off would land on, for one person or everyone", () => {
        expect(affectedBy(events, "st_amy", at(14), at(15)).map((e) => e.id)).toEqual(["b"]);
        expect(affectedBy(events, null, at(14), at(15)).map((e) => e.id)).toEqual(["b", "d"]);
        expect(affectedBy(events, null, at(0), at(0, 8)).map((e) => e.id)).toEqual([
            "a",
            "b",
            "d",
            "e",
        ]);
        expect(affectedBy(events, "st_bo", at(9), at(10))).toEqual([]);
    });
});

describe("rebaseWeek", () => {
    const day = (weekday: number, start: string | null, end: string | null) => ({
        weekday,
        available: start !== null,
        start_time: start,
        end_time: end,
    });
    const base = [day(0, null, null), day(1, "09:00:00", "17:00:00")];

    it("keeps another device's change to a day this person left alone", () => {
        const proposal = [day(0, "09:00:00", "17:00:00"), day(1, "09:00:00", "17:00:00")];
        const current = [day(0, null, null), day(1, "10:00:00", "15:00:00")];
        const merged = rebaseWeek(base, proposal, current);
        expect(merged[0]).toEqual(day(0, "09:00:00", "17:00:00"));
        expect(merged[1]).toEqual(day(1, "10:00:00", "15:00:00"));
        expect(merged).toHaveLength(7);
    });
    it("lets this person's change win on a day both devices changed", () => {
        const proposal = [day(0, null, null), day(1, "08:00:00", "12:00:00")];
        const current = [day(0, null, null), day(1, "10:00:00", "15:00:00")];
        expect(rebaseWeek(base, proposal, current)[1]).toEqual(day(1, "08:00:00", "12:00:00"));
    });
    it("treats a closed day's leftover times as unchanged", () => {
        const proposal = [day(0, null, null), day(1, "09:00:00", "17:00:00")];
        const current = [
            { ...day(0, null, null), start_time: "09:00:00" },
            day(1, "09:00:00", "17:00:00"),
        ];
        expect(rebaseWeek(base, proposal, current)[0]?.start_time).toBe("09:00:00");
    });
});

describe("visits a saved week strands", () => {
    const at = (day: number, h: number, m = 0) => zonedDate(2027, 3, day, h, m, ZONE);
    const tuesday = {
        basis: "recurring",
        weekday: 1,
        date: null,
        start_time: "09:00:00",
        end_time: "17:00:00",
        available: 1,
    };
    const visit = (id: string, start: Date, minutes: number, client: string | null = "Ann") => ({
        id,
        starts_at: start.toISOString(),
        ends_at: new Date(start.getTime() + minutes * 60_000).toISOString(),
        client_name: client,
    });
    const now = at(1, 8);

    it("keeps a visit inside the day's hours and one on a day without hours", () => {
        expect(withinHours([tuesday], at(2, 9), at(2, 10, 15), ZONE)).toBe(true);
        expect(withinHours([tuesday], at(1, 7), at(1, 8), ZONE)).toBe(true);
        expect(withinHours([tuesday], at(2, 16, 30), at(2, 17, 45), ZONE)).toBe(false);
        expect(withinHours([tuesday], at(2, 23), at(3, 0, 15), ZONE)).toBe(false);
    });

    it("lets a date row replace the weekday and close the day", () => {
        const closed = { ...tuesday, basis: "date", weekday: null, date: "2027-03-09" };
        const shut = { ...closed, start_time: null, end_time: null, available: 0 };
        const late = { ...closed, start_time: "18:00:00", end_time: "21:00:00" };
        expect(withinHours([tuesday, shut], at(9, 10), at(9, 11), ZONE)).toBe(false);
        expect(withinHours([tuesday, late], at(9, 10), at(9, 11), ZONE)).toBe(false);
        expect(withinHours([tuesday, late], at(9, 18), at(9, 19), ZONE)).toBe(true);
        expect(withinHours([tuesday, late], at(2, 10), at(2, 11), ZONE)).toBe(true);
    });

    it("lists only future visits still outside the hours, in one line", () => {
        const outside = visit("bk_late", at(2, 16, 30), 75);
        const visits = [
            visit("bk_in", at(2, 10), 60),
            outside,
            visit("bk_past", at(2, 6), 60),
            visit("bk_walkin", at(16, 18), 60, null),
        ];
        const later = at(2, 12);
        expect(strandedNote(visits, [tuesday], later, ZONE)).toBe(
            s.stranded(
                2,
                formatList([
                    formatParts([formatShortDayTime(at(2, 16, 30), ZONE), "Ann"]),
                    formatParts([formatShortDayTime(at(16, 18), ZONE), null]),
                ]),
            ),
        );
        expect(strandedNote([outside], [tuesday], now, ZONE)).toContain("Ann");
        expect(strandedNote([visit("bk_in", at(2, 10), 60)], [tuesday], now, ZONE)).toBeNull();
        expect(strandedNote([], [tuesday], now, ZONE)).toBeNull();
    });
});
