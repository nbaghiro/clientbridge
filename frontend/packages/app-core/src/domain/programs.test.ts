import { describe, expect, it } from "vitest";

import { dateKey } from "../datetime";
import { scheduleDays } from "./programs";

const ZONE = "America/Toronto";

describe("scheduleDays", () => {
    it("lays out a Monday to Friday week from its first day", () => {
        const days = scheduleDays("2026-10-26", ["MO", "TU", "WE", "TH", "FR"], 5, ZONE);
        expect(days.map((d) => dateKey(d, ZONE))).toEqual([
            "2026-10-26",
            "2026-10-27",
            "2026-10-28",
            "2026-10-29",
            "2026-10-30",
        ]);
    });

    it("starts on the first chosen weekday on or after the first day", () => {
        const days = scheduleDays("2026-10-25", ["TU", "TH"], 3, ZONE);
        expect(days.map((d) => dateKey(d, ZONE))).toEqual([
            "2026-10-27",
            "2026-10-29",
            "2026-11-03",
        ]);
    });

    it("lays out nothing without a weekday", () => {
        expect(scheduleDays("2026-10-26", [], 5, ZONE)).toEqual([]);
    });
});
