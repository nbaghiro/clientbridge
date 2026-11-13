// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { BusinessZoneContext } from "../datetime";
import { strings } from "../strings";
import { type TeamMember, useOpenMember, useRemoveMember } from "./staff";

const t = strings.staff.team;

const VISITS = [
    {
        id: "bk_free",
        starts_at: "2027-03-02T17:00:00Z",
        client_name: "Amelie Roy",
        item_name: "Bath",
    },
    {
        id: "bk_stuck",
        starts_at: "2027-03-04T19:00:00Z",
        client_name: "Noah Kim",
        item_name: "Groom",
    },
];

const UNDERWAY: { id: string }[] = [];

vi.mock("../hooks", async (original) => ({
    ...(await original<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string) => ({
        data: sql.includes("s.ends_at")
            ? UNDERWAY
            : sql.includes("FROM slots s JOIN bookings b")
              ? VISITS
              : [],
        isLoading: false,
        error: null,
    }),
}));

vi.mock("./files", async (original) => ({
    ...(await original<typeof import("./files")>()),
    usePeoplePhotos: () => ({ client: () => null, user: () => null, staff: () => null }),
}));

function member(id: string, name: string): TeamMember {
    return {
        id,
        userId: null,
        name,
        title: null,
        color: null,
        role: "staff",
        email: null,
        isYou: false,
        activeLabel: "",
        activeNow: false,
    };
}

const LEE = member("st_lee", "Leaving Lee");
const TAM = member("st_tam", "Taking Tam");

function api(post: () => Promise<unknown>): ApiLike {
    return {
        get: <T>() => Promise.resolve({} as T),
        getText: () => Promise.resolve(""),
        post: <T>() => post() as Promise<T>,
        patch: <T>() => Promise.resolve({} as T),
        delete: <T>() => Promise.resolve({} as T),
    };
}

const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(BusinessZoneContext.Provider, { value: "America/Vancouver" }, children);

describe("useRemoveMember", () => {
    it("marks the visits no member can take, first, and clears them for another taker", async () => {
        const refusal = Object.assign(new Error("POST → 409"), {
            status: 409,
            code: "visits_unplaced",
            detail: {
                visits: [
                    {
                        booking_id: "bk_stuck",
                        starts_at: "2027-03-04T19:00:00Z",
                        problem: "overlap",
                    },
                ],
            },
        });
        const removed = vi.fn();
        const removing = vi.fn();
        const { result } = renderHook(
            () =>
                useRemoveMember(
                    api(() => Promise.reject(refusal)),
                    LEE,
                    [LEE, TAM],
                    removed,
                    removing,
                ),
            { wrapper },
        );
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.error).toBe(t.removeUnplaced(1));
        });
        expect(removed).not.toHaveBeenCalled();
        expect(removing.mock.calls).toEqual([[true], [false]]);
        const [first, second] = result.current.visits;
        expect(first).toMatchObject({
            key: "bk_stuck",
            index: 1,
            intent: "warning",
            state: t.removeUnplacedState,
            note: `Noah Kim${strings.common.separator}Groom${strings.common.separator}${t.removeNoneFree}`,
        });
        expect(second).toMatchObject({ key: "bk_free", index: 2, state: t.removeStateMove });

        act(() => {
            result.current.setTaker(TAM.id);
        });
        expect(result.current.visits.map((v) => v.state)).toEqual([
            t.removeStateMove,
            t.removeStateMove,
        ]);
        expect(result.current.error).toBeNull();
    });

    it("tells the owner how many visits moved", async () => {
        const removed = vi.fn();
        const answer = {
            moved: ["bk_free", "bk_stuck"],
            canceled: [],
            series_moved: [],
            series_ended: [],
        };
        const { result } = renderHook(
            () =>
                useRemoveMember(
                    api(() => Promise.resolve(answer)),
                    LEE,
                    [LEE, TAM],
                    removed,
                    vi.fn(),
                ),
            { wrapper },
        );
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.outcome).toEqual({ body: t.removedMoved(2), series: [] });
        });
        expect(removed).not.toHaveBeenCalled();
    });

    it("lets the record go when the dialog closes mid-removal", () => {
        const removing = vi.fn();
        const { result, unmount } = renderHook(
            () =>
                useRemoveMember(
                    api(() => new Promise(() => undefined)),
                    LEE,
                    [LEE, TAM],
                    vi.fn(),
                    removing,
                ),
            { wrapper },
        );
        act(() => {
            result.current.submit();
        });
        unmount();
        expect(removing.mock.calls).toEqual([[true], [false]]);
    });

    it("keeps the record when the connection drops, so a retry can replay the summary", async () => {
        const removing = vi.fn();
        const { result } = renderHook(
            () =>
                useRemoveMember(
                    api(() => Promise.reject(new TypeError("Network request failed"))),
                    LEE,
                    [LEE, TAM],
                    vi.fn(),
                    removing,
                ),
            { wrapper },
        );
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.error).not.toBeNull();
        });
        expect(removing.mock.calls).toEqual([[true]]);
    });

    it("says a visit under way stays with the member", () => {
        UNDERWAY.push({ id: "bk_now" });
        try {
            const { result } = renderHook(
                () =>
                    useRemoveMember(
                        api(() => Promise.resolve({})),
                        LEE,
                        [LEE, TAM],
                        vi.fn(),
                        vi.fn(),
                    ),
                { wrapper },
            );
            expect(result.current.underwayNote).toBe(t.removeUnderway(1));
        } finally {
            UNDERWAY.length = 0;
        }
    });
});

describe("useOpenMember", () => {
    it("closes when the member leaves the team, unless its removal keeps it open until closed", () => {
        const { result, rerender } = renderHook(({ members }) => useOpenMember(members), {
            initialProps: { members: [LEE, TAM] },
        });
        act(() => {
            result.current.setOpen(LEE.id);
        });
        const renamed = { ...LEE, name: "Lee Renamed" };
        rerender({ members: [renamed, TAM] });
        expect(result.current.open).toBe(renamed);
        rerender({ members: [TAM] });
        expect(result.current.open).toBeUndefined();

        rerender({ members: [LEE, TAM] });
        act(() => {
            result.current.setOpen(LEE.id);
            result.current.keepOpen(true);
        });
        rerender({ members: [TAM] });
        expect(result.current.open?.id).toBe(LEE.id);
        act(() => {
            result.current.setOpen(null);
        });
        expect(result.current.open).toBeUndefined();

        rerender({ members: [LEE, TAM] });
        act(() => {
            result.current.setOpen(LEE.id);
            result.current.keepOpen(true);
        });
        // a refused removal lets go, so a later removal elsewhere closes the record
        act(() => {
            result.current.keepOpen(false);
        });
        rerender({ members: [TAM] });
        expect(result.current.open).toBeUndefined();
    });
});
