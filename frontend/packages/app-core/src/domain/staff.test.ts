// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { strings } from "../strings";
import type { OccurrenceRow } from "../ui";
import { BRAND_COLOURS } from "./staff";
import { formatShortDay } from "../datetime";
import { removalFailure, removalOutcome, useStaffProfileForm } from "./staff";

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

describe("removalFailure", () => {
    const ZONE = "America/Vancouver";
    const camp = [{ id: "sch_camp", item_name: "Spring Camp" }];
    const refused = (detail: Record<string, unknown>): Error =>
        Object.assign(new Error("POST → 409"), { status: 409, code: "schedule_clash", detail });

    it("names the class and the first day its taker isn't free", () => {
        const day = "2027-03-03T18:00:00Z";
        expect(
            removalFailure(refused({ recurrence_id: "sch_camp", starts_at: day }), camp, ZONE),
        ).toBe(t.removeScheduleClash("Spring Camp", formatShortDay(new Date(day), ZONE)));
    });

    it("says when the taker doesn't teach the class, or no day is named", () => {
        const notTaught = refused({ recurrence_id: "sch_camp", problem: "not_offered" });
        expect(removalFailure(notTaught, camp, ZONE)).toBe(
            t.removeScheduleNotTaught("Spring Camp"),
        );
        expect(removalFailure(refused({ recurrence_id: "sch_other" }), camp, ZONE)).toBe(
            t.removeScheduleBusy(t.removeSchedules),
        );
    });

    it("reads any other refusal the usual way", () => {
        const other = Object.assign(new Error("x"), { status: 409, code: "conflict" });
        expect(removalFailure(other, camp, ZONE)).toBe(t.actionError);
    });
});

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

function recordingApi(fail = false): ApiLike & { patched: [string, unknown][] } {
    const patched: [string, unknown][] = [];
    return {
        patched,
        get: <T>() => Promise.resolve({} as T),
        getText: () => Promise.resolve(""),
        post: <T>() => Promise.resolve({} as T),
        patch: <T>(path: string, body: unknown) => {
            patched.push([path, body]);
            return fail ? Promise.reject(new Error("boom")) : Promise.resolve({} as T);
        },
        delete: <T>() => Promise.resolve({} as T),
    };
}

const diego = { id: "st_diego", title: "Senior Groomer", color: "#2E7A5A" };

describe("useStaffProfileForm", () => {
    it("starts from the member and offers the brand palette", () => {
        const { result } = renderHook(() => useStaffProfileForm(recordingApi(), diego, vi.fn()));
        expect(result.current.title).toBe("Senior Groomer");
        expect(result.current.colour).toBe("#2E7A5A");
        expect(result.current.colours).toBe(BRAND_COLOURS);
        expect(result.current.dirty).toBe(false);
    });

    it("sends the trimmed title and the picked colour, then reports done", async () => {
        const api = recordingApi();
        const done = vi.fn();
        const { result } = renderHook(() => useStaffProfileForm(api, diego, done));
        act(() => {
            result.current.setTitle("  Lead Groomer ");
            result.current.setColour("#7D5A82");
        });
        expect(result.current.dirty).toBe(true);
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(done).toHaveBeenCalledOnce();
        });
        expect(api.patched).toEqual([
            ["/v1/staff/st_diego", { title: "Lead Groomer", color: "#7D5A82" }],
        ]);
    });

    it("clears a title and keeps an unset colour unset", async () => {
        const api = recordingApi();
        const member = { id: "st_new", title: "Bather", color: null };
        const { result } = renderHook(() => useStaffProfileForm(api, member, vi.fn()));
        act(() => {
            result.current.setTitle("   ");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(api.patched).toEqual([["/v1/staff/st_new", { title: "", color: "" }]]);
        });
    });

    it("shows the catalog error when the save fails", async () => {
        const done = vi.fn();
        const { result } = renderHook(() => useStaffProfileForm(recordingApi(true), diego, done));
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.error).toBe(strings.staff.team.profileError);
        });
        expect(done).not.toHaveBeenCalled();
    });
});
