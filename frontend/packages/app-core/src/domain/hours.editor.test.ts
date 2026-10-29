// @vitest-environment happy-dom
import { renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, createElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { BusinessZoneContext } from "../datetime";
import { useWeekEditor } from "./hours";

type Rows = Record<string, unknown[]>;

// the live reads lag the replica: each table's rows as the hooks last saw them, and as stored now
const replica: { live: Rows; stored: Rows } = { live: {}, stored: {} };

const rowsFor = (rows: Rows, sql: string): unknown[] =>
    Object.entries(rows).find(([table]) => sql.includes(`FROM ${table} `))?.[1] ?? [];

const db = {
    readTransaction: <T>(read: (tx: object) => Promise<T>) =>
        read({
            getAll: (sql: string) => Promise.resolve(rowsFor(replica.stored, sql)),
            getOptional: (sql: string) => Promise.resolve(rowsFor(replica.stored, sql)[0] ?? null),
        }),
};

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string) => ({
        data: rowsFor(replica.live, sql),
        isLoading: false,
        isFetching: false,
    }),
}));
vi.mock("./business", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./business")>()),
    useBusinessId: () => "bu_1",
}));
vi.mock("./sync", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./sync")>()),
    useDevicePref: () => [null, () => undefined],
}));
vi.mock("@powersync/react", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@powersync/react")>()),
    usePowerSync: () => db,
}));

const api: ApiLike = {
    get: <T>() => Promise.resolve({} as T),
    getText: () => Promise.resolve(""),
    post: <T>() => Promise.resolve({} as T),
    patch: <T>() => Promise.resolve({} as T),
    delete: <T>() => Promise.resolve({} as T),
};

const mondayOnly = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    available: weekday === 0,
    start_time: weekday === 0 ? "10:00" : null,
    end_time: weekday === 0 ? "16:00" : null,
}));

const accepted = {
    id: "op_1",
    payload: JSON.stringify({ expected_revision: 0, days: mondayOnly }),
    base: "[]",
    state: "accepted",
    result_revision: 1,
};

const storedMondayOnly = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    start_time: weekday === 0 ? "10:00:00" : "09:00:00",
    end_time: weekday === 0 ? "16:00:00" : "17:00:00",
    available: weekday === 0 ? 1 : 0,
}));

const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(BusinessZoneContext.Provider, { value: "America/Vancouver" }, children);

beforeEach(() => {
    replica.live = {};
    replica.stored = {};
});

async function openedWeek() {
    const { result } = renderHook(() => useWeekEditor(api, "st_1"), { wrapper });
    await waitFor(() => {
        expect(result.current.ready).toBe(true);
    });
    return result.current;
}

function expectMondayOnly(days: { weekday: number; open: boolean }[]) {
    expect(days.find((d) => d.weekday === 0)).toMatchObject({
        open: true,
        start: "10:00",
        end: "16:00",
    });
    expect(days.filter((d) => d.open)).toHaveLength(1);
}

it("opens on the accepted week once the replica has it, even before the hours read refreshes", async () => {
    replica.live = { staff: [{ hours_revision: 1 }], hours_outbox: [accepted], hours: [] };
    replica.stored = {
        staff: [{ hours_revision: 1 }],
        hours_outbox: [accepted],
        hours: storedMondayOnly,
    };
    expectMondayOnly((await openedWeek()).days);
});

it("opens on the queued week while the server's answer hasn't synced, even before the outbox read refreshes", async () => {
    replica.live = { staff: [{ hours_revision: 0 }], hours_outbox: [], hours: [] };
    replica.stored = { staff: [{ hours_revision: 0 }], hours_outbox: [accepted], hours: [] };
    expectMondayOnly((await openedWeek()).days);
});

it("opens on the replica's hours when nothing is queued", async () => {
    replica.live = { staff: [{ hours_revision: 0 }] };
    replica.stored = { staff: [{ hours_revision: 0 }] };
    const editor = await openedWeek();
    expect(editor.days.filter((d) => d.open).map((d) => d.weekday)).toEqual([0, 1, 2, 3, 4]);
    expect(editor.saveMessage).toBeNull();
});

it("waits for the member's staff row before opening", () => {
    const { result } = renderHook(() => useWeekEditor(api, "st_1"), { wrapper });
    expect(result.current.ready).toBe(false);
});
