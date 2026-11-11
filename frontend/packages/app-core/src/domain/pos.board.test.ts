// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import {
    BusinessZoneContext,
    formatTimeRange,
    parseTimestamp,
    relativeDay,
    relativeDayTime,
} from "../datetime";
import { formatPhone } from "../format";
import { strings } from "../strings";
import { TEXTS_STOPPED_SQL } from "./broadcasts";
import {
    PICKUP_LINES_SQL,
    PICKUP_ORDERS_SQL,
    SALE_RECORD_SQL,
    useFrontDeskBoard,
    useSaleDetail,
} from "./pos";

const rows = vi.hoisted(() => new Map<string, unknown[]>());

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string) => ({ data: rows.get(sql) ?? [], isLoading: false }),
}));

vi.mock("@powersync/react", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@powersync/react")>()),
    usePowerSync: () => ({
        registerListener: () => () => undefined,
        currentStatus: { hasSynced: true },
    }),
}));

const ZONE = "America/Vancouver";
const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(BusinessZoneContext.Provider, { value: ZONE }, children);

const pickup = (notify: number) => ({
    id: "ord_1",
    number: 22,
    client_id: "cl_1",
    client_name: "Robin Bennett",
    phone: "+12505550201",
    pickup_status: "preparing",
    total_cents: 5936,
    created_at: "2026-10-13T15:00:00Z",
    ready_at: null,
    picked_up_at: null,
    pickup_from: null,
    pickup_to: null,
    note: null,
    notify_sms: notify,
});

function board(notify: number, change: Record<string, unknown> = {}, stopped: string[] = []) {
    rows.set(PICKUP_ORDERS_SQL, [{ ...pickup(notify), ...change }]);
    rows.set(PICKUP_LINES_SQL, []);
    rows.set(
        TEXTS_STOPPED_SQL,
        stopped.map((client_id) => ({ client_id, created_at: "2026-10-12T15:00:00Z" })),
    );
    let answer: (() => void) | undefined;
    const api: ApiLike = {
        get: <T>() => Promise.resolve([] as T),
        getText: () => Promise.resolve(""),
        post: <T>() =>
            new Promise<T>((resolve) => {
                answer = () => {
                    resolve({} as T);
                };
            }),
        patch: <T>() => Promise.resolve({} as T),
        delete: <T>() => Promise.resolve({} as T),
    };
    const hook = renderHook(() => useFrontDeskBoard(api, () => undefined), { wrapper });
    return { hook, answer: () => answer?.() };
}

describe("the front desk board", () => {
    it("says the order is ready only once the server took it, and that the client was texted", async () => {
        const { hook, answer } = board(1);
        act(() => {
            hook.result.current.advance("ord_1");
        });
        expect(hook.result.current.done).toBeNull();
        act(() => {
            answer();
        });
        await waitFor(() => {
            expect(hook.result.current.done).toBe(strings.pos.desk.markedReady("Robin Bennett"));
        });
    });

    it.each([
        ["turned texts off", board.bind(null, 0)],
        ["has no phone number", board.bind(null, 1, { phone: null })],
        ["has a number no text can reach", board.bind(null, 1, { phone: "555-0142" })],
        ["replied STOP", board.bind(null, 1, {}, ["cl_1"])],
    ])("doesn't claim a text went to a client who %s", async (_, open) => {
        const { hook, answer } = open();
        act(() => {
            hook.result.current.advance("ord_1");
        });
        act(() => {
            answer();
        });
        await waitFor(() => {
            expect(hook.result.current.done).toBe(
                strings.pos.desk.markedReadyNoText("Robin Bennett"),
            );
        });
    });

    it("shows the whole pickup window on the card", () => {
        const { hook } = board(1, {
            pickup_from: "2026-10-15T16:00:00Z",
            pickup_to: "2026-10-15T17:00:00Z",
        });
        const from = parseTimestamp("2026-10-15T16:00:00Z");
        const card = hook.result.current.columns.flatMap((column) => column.cards)[0];
        expect(card?.note).toBe(
            strings.publicShop.pickupWindowAt(
                strings.common.dayAndTime(
                    relativeDay(from, ZONE, "short", new Date()),
                    formatTimeRange(from, parseTimestamp("2026-10-15T17:00:00Z"), ZONE),
                ),
            ),
        );
    });
});

describe("an online order's sale panel", () => {
    it("shows its pickup, that it was placed online and where its receipt went", () => {
        rows.set(SALE_RECORD_SQL, [
            {
                id: "ord_1",
                number: 22,
                client_id: "cl_1",
                client_name: "Robin Bennett",
                client_phone: "+12505550201",
                source: "online",
                pickup_status: "ready",
                created_at: "2026-10-13T15:00:00Z",
                subtotal_cents: 5300,
                tax_total_cents: 636,
                total_cents: 5936,
                staff_id: "st_owner",
                note: null,
                discount_kind: null,
                discount_value: null,
                discount_reason: null,
                receipt_phone: "+12505550201",
                receipt_sent_at: "2026-10-13T15:01:00Z",
                ready_at: "2026-10-13T16:00:00Z",
                picked_up_at: null,
                pickup_from: null,
                pickup_to: null,
                status: "paid",
            },
        ]);
        const { result } = renderHook(() => useSaleDetail("ord_1", "owner"), { wrapper });
        const detail = result.current.detail;
        expect(detail?.origin).toBe(strings.pos.desk.placedOnline);
        expect(detail?.receipt).toBe(strings.pos.desk.sentBy(formatPhone("+12505550201")));
        expect(detail?.pickup).toMatchObject({
            label: strings.pos.pickup.ready,
            window: null,
        });
        expect(detail?.pickup?.when).toBe(
            strings.pos.pickup.readySince(
                relativeDayTime(parseTimestamp("2026-10-13T16:00:00Z"), ZONE, new Date()),
            ),
        );
    });

    it("shows the whole pickup window", () => {
        const [record] = rows.get(SALE_RECORD_SQL) ?? [];
        rows.set(SALE_RECORD_SQL, [
            {
                ...(record as object),
                pickup_from: "2026-10-15T16:00:00Z",
                pickup_to: "2026-10-15T17:00:00Z",
            },
        ]);
        const { result } = renderHook(() => useSaleDetail("ord_1", "owner"), { wrapper });
        const from = parseTimestamp("2026-10-15T16:00:00Z");
        expect(result.current.detail?.pickup?.window).toBe(
            strings.publicShop.pickupWindowAt(
                strings.common.dayAndTime(
                    relativeDay(from, ZONE, "short", new Date()),
                    formatTimeRange(from, parseTimestamp("2026-10-15T17:00:00Z"), ZONE),
                ),
            ),
        );
        rows.set(SALE_RECORD_SQL, [record]);
    });

    it("claims no receipt the server didn't record, as for an order that was never paid", () => {
        const [record] = rows.get(SALE_RECORD_SQL) ?? [];
        rows.set(SALE_RECORD_SQL, [
            {
                ...(record as object),
                status: "void",
                pickup_status: null,
                receipt_phone: null,
                receipt_sent_at: null,
            },
        ]);
        const { result } = renderHook(() => useSaleDetail("ord_1", "owner"), { wrapper });
        expect(result.current.detail?.receipt).toBeNull();
        expect(result.current.detail?.pickup).toBeNull();
    });
});
