import { describe, expect, it } from "vitest";

import { strings } from "../strings";
import type { OccurrenceRow } from "../ui";
import { removalOutcome } from "./staff";

const t = strings.staff.team;

const SERIES = [
    { id: "rec_a", item_name: "Full Groom", client_name: "Amelie Roy" },
    { id: "rec_b", item_name: "Nail Trim", client_name: null },
];
const MEMBERS = [
    { id: "st_tam", name: "Taking Tam" },
    { id: "st_lee", name: "Leaving Lee" },
];
const LEFT: OccurrenceRow = {
    key: "bk_1",
    index: 1,
    date: "Tue, Mar 2",
    time: "11:00 a.m.",
    intent: "warning",
    state: t.removeLeftState,
    note: null,
};

describe("removalOutcome", () => {
    it("is null when nothing was left, moved or ended", () => {
        expect(removalOutcome({ series_moved: [], series_ended: [] }, SERIES, MEMBERS, [])).toBe(
            null,
        );
    });

    it("names each moved series with its new member and each ended one", () => {
        const outcome = removalOutcome(
            {
                series_moved: [{ recurrence_id: "rec_a", staff_id: "st_tam" }],
                series_ended: ["rec_b"],
            },
            SERIES,
            MEMBERS,
            [],
        );
        expect(outcome?.body).toBe(
            strings.common.twoSentences(t.removedSeriesMoved(1), t.removedSeriesEnded(1)),
        );
        expect(outcome?.series).toEqual([
            {
                key: "rec_a",
                icon: "repeat",
                title: `Full Groom${strings.common.separator}Amelie Roy`,
                detail: t.removedSeriesNowWith("Taking Tam"),
            },
            { key: "rec_b", icon: "repeat", title: "Nail Trim", detail: t.removedSeriesEndedState },
        ]);
        expect(outcome?.left).toEqual([]);
    });

    it("counts several series in one plural line per outcome", () => {
        const outcome = removalOutcome(
            { series_moved: [], series_ended: ["rec_a", "rec_b"] },
            SERIES,
            MEMBERS,
            [],
        );
        expect(outcome?.body).toBe(t.removedSeriesEnded(2));
        expect(outcome?.series.map((f) => f.detail)).toEqual([
            t.removedSeriesEndedState,
            t.removedSeriesEndedState,
        ]);
    });

    it("keeps visits left in place alongside the series", () => {
        const outcome = removalOutcome(
            { series_moved: [], series_ended: ["rec_a"] },
            SERIES,
            MEMBERS,
            [LEFT],
        );
        expect(outcome?.body).toBe(
            strings.common.twoSentences(t.removeLeftBody(1), t.removedSeriesEnded(1)),
        );
        expect(outcome?.left).toEqual([LEFT]);
    });

    it("falls back to generic labels for a series or member it cannot name", () => {
        const outcome = removalOutcome(
            { series_moved: [{ recurrence_id: "rec_x", staff_id: "st_gone" }], series_ended: [] },
            SERIES,
            MEMBERS,
            [],
        );
        expect(outcome?.series).toEqual([
            {
                key: "rec_x",
                icon: "repeat",
                title: t.removedSeries,
                detail: t.removedSeriesMovedState,
            },
        ]);
    });
});
