import { describe, expect, it } from "vitest";

import { formatTime } from "../datetime";
import type { ScheduleEvent } from "./bookings";
import { affectedBy, seedDays, shiftLabel } from "./hours";

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
            { weekday: 0, open: true, start: "09:00", end: "17:00" },
            { weekday: 1, open: true, start: "09:00", end: "17:00" },
            { weekday: 2, open: true, start: "09:00", end: "17:00" },
            { weekday: 3, open: true, start: "09:00", end: "17:00" },
            { weekday: 4, open: true, start: "09:00", end: "17:00" },
            { weekday: 5, open: false, start: "09:00", end: "17:00" },
            { weekday: 6, open: false, start: "09:00", end: "17:00" },
        ]);
    });

    it("spans a split day from its first start to its last end, and keeps a closed day closed", () => {
        const days = seedDays([
            row(1, "08:30:00", "12:00:00"),
            row(1, "13:00:00", "18:15:00"),
            row(3, "09:00:00", "17:00:00", 0),
            row(5, "10:00:00", "14:00:00"),
        ]);
        expect(days[1]).toEqual({ weekday: 1, open: true, start: "08:30", end: "18:15" });
        expect(days[3]).toEqual({ weekday: 3, open: false, start: "09:00", end: "17:00" });
        expect(days[5]).toEqual({ weekday: 5, open: true, start: "10:00", end: "14:00" });
        expect(days[0]?.open).toBe(true);
        expect(days[6]?.open).toBe(false);
    });

    it("labels a shift in full or as a short twelve-hour span", () => {
        const t = (h: number, m = 0) => formatTime(new Date(2000, 0, 1, h, m));
        expect(shiftLabel("09:00", "17:00")).toBe(`${t(9)} – ${t(17)}`);
        expect(shiftLabel("09:00", "17:00", true)).toBe("9–5");
        expect(shiftLabel("08:30", "12:00", true)).toBe("8:30–12");
        expect(shiftLabel("00:00", "13:05", true)).toBe("12–1:05");
    });
});

describe("affectedBy", () => {
    const at = (h: number, day = 7) => new Date(2026, 9, day, h);
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
