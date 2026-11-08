// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { strings } from "../strings";
import {
    CLIENT_INVOICES_SQL,
    CLIENT_MESSAGES_SQL,
    CLIENT_NOTES_SQL,
    CLIENT_HISTORY_SOURCES_SQL,
    CLIENT_VISITS_SQL,
    historyHorizon,
    mergeById,
    useClientHistory,
} from "./clients";

const visit = (id: string, starts_at: string) => ({
    id,
    status: "completed",
    subject_id: null,
    staff_id: "st_owner",
    deposit_amount_cents: 0,
    deposit_status: "none",
    starts_at,
    ends_at: starts_at,
    item_name: `Groom ${id}`,
    item_color: null,
    subject_name: null,
    staff_name: "Hannah",
});

const replica: Record<string, unknown[]> = {
    [CLIENT_HISTORY_SOURCES_SQL]: [
        { id: "th_ann", created_at: "2024-01-05T00:00:00Z" },
        { id: "visits", created_at: "2024-01-05T00:00:00Z" },
    ],
    [CLIENT_VISITS_SQL]: [
        { ...visit("bk_recent", "2026-09-01T17:00:00Z"), waitlist_closed: 0 },
        // a month the calendar subscribed, so the server's page repeats it
        { ...visit("bk_aug", "2025-08-01T17:00:00Z"), waitlist_closed: 0 },
    ],
    [CLIENT_MESSAGES_SQL]: [
        { id: "ms_recent", direction: "out", body: "See you soon", at: "2026-09-02T17:00:00Z" },
    ],
    [CLIENT_NOTES_SQL]: [
        {
            id: "nt_old",
            parent_type: "client",
            parent_id: "cl_ann",
            body: "Old note",
            pinned: 0,
            created_by: null,
            created_at: "2025-06-01T17:00:00Z",
            author_staff_id: null,
            author_name: "Hannah",
            subject_name: null,
        },
    ],
    [CLIENT_INVOICES_SQL]: [
        { id: "in_old", number: 7, status: "paid", total_cents: 100, at: "2025-03-01T17:00:00Z" },
    ],
};

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string) => ({ data: replica[sql] ?? [], isLoading: false }),
}));

vi.mock("../datetime", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../datetime")>()),
    useBusinessZone: () => "America/Vancouver",
}));

vi.mock("./subjects", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./subjects")>()),
    useSubjectKind: () => null,
}));

vi.mock("./sync", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./sync")>()),
    useReplicaLoad: () => ({ state: "ready", ready: true, hasData: true }),
}));

const seeded = { ...replica };

afterEach(() => {
    Object.assign(replica, seeded);
});

const pages = (): Record<string, unknown[]> => ({
    "/v1/bookings/visits?before=2025-10-01T00%3A00%3A00.000Z&client_id=cl_ann": [
        {
            visits: [
                { ...visit("bk_aug", "2025-08-01T17:00:00Z"), waitlist_closed: false },
                { ...visit("bk_may", "2025-05-01T17:00:00Z"), waitlist_closed: false },
            ],
            more: true,
        },
    ],
    "/v1/bookings/visits?before=2025-05-01T17%3A00%3A00Z&before_id=bk_may&client_id=cl_ann": [
        {
            visits: [{ ...visit("bk_feb", "2025-02-01T17:00:00Z"), waitlist_closed: false }],
            more: false,
        },
    ],
    "/v1/threads/th_ann/messages?before=2025-10-01T00%3A00%3A00.000Z": [
        {
            messages: [
                {
                    id: "ms_promo",
                    direction: "out",
                    body: "Spring promo",
                    created_at: "2025-07-02T17:00:00Z",
                    broadcast_id: "br_1",
                },
                {
                    id: "ms_welcome",
                    direction: "out",
                    body: "Welcome",
                    created_at: "2025-07-01T17:00:00Z",
                    broadcast_id: null,
                },
            ],
            more: false,
        },
    ],
});

function fakeApi(fail?: Error): { api: ApiLike; get: ReturnType<typeof vi.fn> } {
    const queue = pages();
    const get = vi.fn((path: string) => {
        if (fail !== undefined) return Promise.reject(fail);
        const page = queue[path]?.shift();
        return page === undefined
            ? Promise.reject(new Error(`unexpected ${path}`))
            : Promise.resolve(page);
    });
    const api = { get, getText: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
    return { api: api as unknown as ApiLike, get };
}

const keys = (h: ReturnType<typeof useClientHistory>) =>
    h.groups.flatMap((g) => g.entries.map((e) => e.key));

describe("historyHorizon", () => {
    it("is the newest point a still-paging source reached, or none once all are read", () => {
        const at = (before: string, more: boolean) => ({ before, beforeId: null, more });
        expect(historyHorizon([])).toBeNull();
        expect(historyHorizon([at("2025-05-01T00:00:00Z", false)])).toBeNull();
        expect(
            historyHorizon([at("2025-05-01T00:00:00Z", true), at("2025-07-01T00:00:00Z", true)]),
        ).toEqual(new Date("2025-07-01T00:00:00Z"));
    });
});

describe("mergeById", () => {
    it("keeps the device's copy of a row a server page repeats", () => {
        const merged = mergeById(
            [
                { id: "a", v: 1 },
                { id: "b", v: 1 },
            ],
            [{ id: "a", v: 2 }],
        );
        expect(merged).toEqual([
            { id: "a", v: 2 },
            { id: "b", v: 1 },
        ]);
    });
});

describe("useClientHistory older history", () => {
    it("reads visits and messages past the device window page by page, without gaps or repeats", async () => {
        const { api, get } = fakeApi();
        const { result } = renderHook(() => useClientHistory(api, "cl_ann", null));
        expect(keys(result.current)).toEqual(["ms_recent", "bk_recent"]);
        expect(result.current.hasOlder).toBe(true);

        act(() => {
            result.current.showOlder();
        });
        await waitFor(() => {
            expect(keys(result.current)).toEqual([
                "ms_recent",
                "bk_recent",
                "bk_aug",
                "ms_welcome",
                "nt_old",
                "bk_may",
            ]);
        });
        expect(result.current.hasOlder).toBe(true);

        act(() => {
            result.current.showOlder();
        });
        await waitFor(() => {
            expect(keys(result.current).slice(-2)).toEqual(["in_old", "bk_feb"]);
        });
        expect(result.current.hasOlder).toBe(false);
        expect(get).toHaveBeenCalledTimes(3);
    });

    it("says older history failed to load and keeps the button to retry", async () => {
        const { result } = renderHook(() =>
            useClientHistory(fakeApi(new Error("boom")).api, "cl_ann", null),
        );
        act(() => {
            result.current.showOlder();
        });
        await waitFor(() => {
            expect(result.current.older.error).toBe(strings.clients.history.olderFailed);
        });
        expect(result.current.hasOlder).toBe(true);
        expect(keys(result.current)).toEqual(["ms_recent", "bk_recent"]);
    });

    it("offline, shows the device's own older notes and money and keeps the button to retry", async () => {
        const { result } = renderHook(() =>
            useClientHistory(fakeApi(new TypeError("Failed to fetch")).api, "cl_ann", null),
        );
        act(() => {
            result.current.showOlder();
        });
        await waitFor(() => {
            expect(result.current.older.error).toBe(strings.clients.history.olderOffline);
        });
        expect(keys(result.current)).toEqual([
            "ms_recent",
            "bk_recent",
            "bk_aug",
            "nt_old",
            "in_old",
        ]);
        expect(result.current.hasOlder).toBe(true);
    });

    it("reads only sources that began before the window, and keeps its pages when a thread starts", async () => {
        replica[CLIENT_HISTORY_SOURCES_SQL] = [
            { id: "th_ann", created_at: "2024-01-05T00:00:00Z" },
            { id: "th_new", created_at: "2026-09-02T00:00:00Z" },
            { id: "visits", created_at: "2024-01-05T00:00:00Z" },
        ];
        const { api, get } = fakeApi();
        const { result, rerender } = renderHook(() => useClientHistory(api, "cl_ann", null));
        act(() => {
            result.current.showOlder();
        });
        await waitFor(() => {
            expect(keys(result.current)).toContain("bk_may");
        });
        expect(get.mock.calls.map(([path]) => String(path).split("?")[0])).toEqual([
            "/v1/threads/th_ann/messages",
            "/v1/bookings/visits",
        ]);
        replica[CLIENT_HISTORY_SOURCES_SQL] = [
            ...(replica[CLIENT_HISTORY_SOURCES_SQL] ?? []),
            { id: "th_newest", created_at: "2026-10-01T00:00:00Z" },
        ];
        rerender();
        expect(keys(result.current)).toContain("bk_may");
    });

    it("says since when a client has had nothing in the months the device keeps", () => {
        replica[CLIENT_VISITS_SQL] = [];
        replica[CLIENT_MESSAGES_SQL] = [];
        const { result } = renderHook(() => useClientHistory(fakeApi().api, "cl_ann", null));
        expect(result.current.groups).toEqual([]);
        expect(result.current.hasOlder).toBe(true);
        expect(result.current.emptyMessage).toBe(
            strings.clients.history.emptySince("October 2025"),
        );
    });
});
