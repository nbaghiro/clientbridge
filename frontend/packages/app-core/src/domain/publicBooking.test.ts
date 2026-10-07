import { describe, expect, it } from "vitest";

import { dateKey, formatTime, formatWeekday } from "../datetime";
import { strings } from "../strings";
import { groupSlots, icsFor, toStrip, whenLabel } from "./publicBooking";

const s = strings.publicBooking;

const at = (day: number, h: number, m = 0): Date => new Date(2026, 9, day, h, m);
const slot = (d: Date, staff: string | null = null) => ({
    starts_at: d.toISOString(),
    ends_at: new Date(d.getTime() + 3_600_000).toISOString(),
    staff_id: staff,
});

describe("open times", () => {
    it("groups times into morning, afternoon and evening, dropping empty parts", () => {
        const groups = groupSlots(
            [slot(at(7, 9)), slot(at(7, 11, 59)), slot(at(7, 17)), slot(at(7, 20, 30))],
            (id) => `Staff ${id}`,
        );
        expect(groups.map((g) => [g.label, g.slots.length])).toEqual([
            [s.morning, 2],
            [s.evening, 2],
        ]);
        expect(groups[0]?.slots[0]).toEqual({
            key: at(7, 9).toISOString(),
            label: formatTime(at(7, 9)),
        });
        expect(groups.map((g) => g.label)).not.toContain(s.afternoon);
        expect(groupSlots([], undefined)).toEqual([]);
    });

    it("hints who a time is with when the page names staff", () => {
        const [afternoon] = groupSlots([slot(at(7, 12), "st_amy"), slot(at(7, 16, 59))], (id) =>
            id === "st_amy" ? "Amy" : "",
        );
        expect(afternoon?.label).toBe(s.afternoon);
        expect(afternoon?.slots.map((x) => x.hint)).toEqual(["Amy", undefined]);
    });

    it("builds a week strip with busy levels, closures and days before today disabled", () => {
        const strip = toStrip(
            [
                { date: "2026-10-05", count: 5, closed: false, reason: null },
                { date: "2026-10-06", count: 0, closed: false, reason: null },
                { date: "2026-10-07", count: 3, closed: false, reason: null },
                { date: "2026-10-08", count: 4, closed: false, reason: null },
                { date: "2026-10-09", count: 10, closed: false, reason: null },
                { date: "2026-10-10", count: 0, closed: true, reason: "Holiday" },
            ],
            "2026-10-05",
            "2026-10-06",
        );
        expect(strip.map((d) => [d.key, d.busy, d.closed, d.disabled, d.isToday])).toEqual([
            ["2026-10-05", 2, false, true, false],
            ["2026-10-06", 0, false, true, true],
            ["2026-10-07", 1, false, false, false],
            ["2026-10-08", 2, false, false, false],
            ["2026-10-09", 3, false, false, false],
            ["2026-10-10", 0, true, false, false],
            ["2026-10-11", 0, false, false, false],
        ]);
        expect(strip[2]).toMatchObject({ weekday: formatWeekday(at(7, 0)), day: "7" });
        expect(toStrip(null, "2026-12-29", "2026-12-01").map((d) => d.key)).toEqual([
            "2026-12-29",
            "2026-12-30",
            "2026-12-31",
            "2027-01-01",
            "2027-01-02",
            "2027-01-03",
            "2027-01-04",
        ]);
    });

    it("says when a visit is, naming today and tomorrow", () => {
        const today = dateKey(at(7, 0));
        expect(whenLabel(at(7, 14).toISOString(), today)).toBe(
            s.at(s.today, formatTime(at(7, 14))),
        );
        expect(whenLabel(at(8, 9).toISOString(), today)).toBe(
            s.at(s.tomorrow, formatTime(at(8, 9))),
        );
        const later = whenLabel(at(12, 9).toISOString(), today);
        expect(later).toContain("October 12");
        expect(later.endsWith(formatTime(at(12, 9)))).toBe(true);
    });
});

describe("icsFor", () => {
    it("writes one escaped UTC event with CRLF line endings", () => {
        const ics = icsFor({
            uid: "bk_01J.birch-studio",
            title: "Groom, wash; trim\\",
            starts_at: "2026-10-07 17:00:00+00",
            ends_at: "2026-10-07T18:30:00Z",
            location: "Birch Studio, Victoria",
        });
        const lines = ics.split("\r\n");
        expect(lines).toHaveLength(12);
        expect(lines.slice(0, 4)).toEqual([
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Clientbridge//Booking//EN",
            "BEGIN:VEVENT",
        ]);
        expect(lines[4]).toBe("UID:bk_01J.birch-studio@clientbridge.ca");
        expect(lines[5]).toMatch(/^DTSTAMP:\d{8}T\d{6}Z$/);
        expect(lines.slice(6)).toEqual([
            "DTSTART:20261007T170000Z",
            "DTEND:20261007T183000Z",
            "SUMMARY:Groom\\, wash\\; trim\\\\",
            "LOCATION:Birch Studio\\, Victoria",
            "END:VEVENT",
            "END:VCALENDAR",
        ]);
    });

    it("escapes line breaks so a multi-line field stays on one content line", () => {
        const ics = icsFor({
            uid: "bk_1.birch",
            title: "Groom",
            starts_at: "2026-10-07T17:00:00Z",
            ends_at: "2026-10-07T18:00:00Z",
            location: "12 Main St\r\nUnit 4\nVictoria, BC",
        });
        expect(ics.split("\r\n")).toContain("LOCATION:12 Main St\\nUnit 4\\nVictoria\\, BC");
    });

    it("gives each visit its own UID, even two of the same service at the same time", () => {
        const visit = {
            title: "Groom",
            starts_at: "2026-10-07T17:00:00Z",
            ends_at: "2026-10-07T18:00:00Z",
            location: "Birch",
        };
        const uid = (ics: string): string | undefined =>
            ics.split("\r\n").find((l) => l.startsWith("UID:"));
        const a = uid(icsFor({ ...visit, uid: "bk_1.birch" }));
        const b = uid(icsFor({ ...visit, uid: "bk_2.birch" }));
        const c = uid(icsFor({ ...visit, uid: "bk_1.fjord" }));
        expect(new Set([a, b, c]).size).toBe(3);
    });
});
