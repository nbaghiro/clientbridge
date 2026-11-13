// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { strings } from "../strings";
import { BRAND_COLOURS } from "./staff";
import { formatShortDay } from "../datetime";
import { removalFailure, removalOutcome, useStaffPayForm, useStaffProfileForm } from "./staff";

const t = strings.staff.team;

const SERIES = [
    { id: "rec_a", item_name: "Full Groom", client_name: "Amelie Roy" },
    { id: "rec_b", item_name: "Nail Trim", client_name: null },
];
const MEMBERS = [
    { id: "st_tam", name: "Taking Tam" },
    { id: "st_lee", name: "Leaving Lee" },
];
const NOTHING = { moved: [], canceled: [], series_moved: [], series_ended: [] };

describe("removalFailure", () => {
    const ZONE = "America/Vancouver";
    const camp = [{ id: "sch_camp", item_name: "Spring Camp" }];
    const refused = (detail: Record<string, unknown>): Error =>
        Object.assign(new Error("POST → 409"), { status: 409, code: "schedule_clash", detail });

    it("names the class and the first day the member chosen isn't free", () => {
        const day = "2027-03-03T18:00:00Z";
        expect(
            removalFailure(
                refused({ recurrence_id: "sch_camp", starts_at: day, problem: "overlap" }),
                camp,
                ZONE,
                "st_tam",
            ),
        ).toBe(t.removeScheduleClash("Spring Camp", formatShortDay(new Date(day), ZONE)));
    });

    it("says when the member chosen doesn't teach the class, or no day is named", () => {
        const notTaught = refused({ recurrence_id: "sch_camp", problem: "not_offered" });
        expect(removalFailure(notTaught, camp, ZONE, "st_tam")).toBe(
            t.removeScheduleNotTaught("Spring Camp"),
        );
        expect(removalFailure(refused({ recurrence_id: "sch_other" }), camp, ZONE, "st_tam")).toBe(
            t.removeScheduleTakerBusy(t.removeSchedules),
        );
    });

    it("speaks of every member, not one chosen, when any available member was asked", () => {
        const day = "2027-03-03T18:00:00Z";
        const notTaught = refused({ recurrence_id: "sch_camp", problem: "not_offered" });
        expect(removalFailure(notTaught, camp, ZONE, "any")).toBe(
            t.removeScheduleNoTeacher("Spring Camp"),
        );
        const busy = refused({ recurrence_id: "sch_camp", starts_at: day, problem: "overlap" });
        expect(removalFailure(busy, camp, ZONE, "any")).toBe(t.removeScheduleBusy("Spring Camp"));
    });

    it("counts the visits no member can take", () => {
        const unplaced = Object.assign(new Error("POST → 409"), {
            status: 409,
            code: "visits_unplaced",
            detail: {
                visits: [
                    { booking_id: "bk_1", starts_at: "2027-03-02T19:00:00Z", problem: "overlap" },
                    { booking_id: "bk_2", starts_at: "2027-03-04T19:00:00Z", problem: null },
                ],
            },
        });
        expect(removalFailure(unplaced, camp, ZONE, "any")).toBe(t.removeUnplaced(2));
    });

    it("reads any other refusal the usual way", () => {
        const other = Object.assign(new Error("x"), { status: 409, code: "conflict" });
        expect(removalFailure(other, camp, ZONE, "any")).toBe(t.actionError);
    });
});

describe("removalOutcome", () => {
    it("is null when the member had no visits or series", () => {
        expect(removalOutcome(NOTHING, SERIES, MEMBERS)).toBe(null);
    });

    it("counts the visits moved and canceled", () => {
        expect(removalOutcome({ ...NOTHING, moved: ["bk_1", "bk_2"] }, SERIES, MEMBERS)).toEqual({
            body: t.removedMoved(2),
            series: [],
        });
        expect(removalOutcome({ ...NOTHING, canceled: ["bk_1"] }, SERIES, MEMBERS)?.body).toBe(
            t.removedCanceled(1),
        );
    });

    it("names each moved series with its new member and each ended one", () => {
        const outcome = removalOutcome(
            {
                ...NOTHING,
                moved: ["bk_1"],
                series_moved: [{ recurrence_id: "rec_a", staff_id: "st_tam" }],
                series_ended: ["rec_b"],
            },
            SERIES,
            MEMBERS,
        );
        expect(outcome?.body).toBe(
            [t.removedMoved(1), t.removedSeriesMoved(1), t.removedSeriesEnded(1)].reduce((a, b) =>
                strings.common.twoSentences(a, b),
            ),
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
    });

    it("counts several series in one plural line per outcome", () => {
        const outcome = removalOutcome(
            { ...NOTHING, series_ended: ["rec_a", "rec_b"] },
            SERIES,
            MEMBERS,
        );
        expect(outcome?.body).toBe(t.removedSeriesEnded(2));
        expect(outcome?.series.map((f) => f.detail)).toEqual([
            t.removedSeriesEndedState,
            t.removedSeriesEndedState,
        ]);
    });

    it("falls back to generic labels for a series or member it cannot name", () => {
        const outcome = removalOutcome(
            { ...NOTHING, series_moved: [{ recurrence_id: "rec_x", staff_id: "st_gone" }] },
            SERIES,
            MEMBERS,
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

describe("useStaffPayForm", () => {
    it("explains what a fixed rate pays for only while fixed is chosen", () => {
        const row = {
            id: "st_1",
            title: null,
            role: "staff",
            invite_email: null,
            payee: 1,
            rate_type: "percent",
            rate_bps: 4000,
            rate_cents: null,
            retail_rate_bps: null,
        };
        const { result } = renderHook(() => useStaffPayForm(recordingApi(), row, vi.fn()));
        expect(result.current.rateHint).toBeUndefined();
        act(() => {
            result.current.setRateType("fixed");
        });
        expect(result.current.rateHint).toBe(strings.staff.rateFixedHint);
    });
});
