// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BusinessZoneContext } from "../datetime";
import { NOTIFICATION_FEED_SQL, useNotifications } from "./notifications";

const feed = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string) => ({
        data: sql === NOTIFICATION_FEED_SQL ? feed.rows : [],
        isLoading: false,
        error: null,
    }),
}));

vi.mock("./sync", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./sync")>()),
    useReplicaLoad: () => ({ state: "ready", retry: () => undefined }),
    useDeviceList: () => [[], () => undefined],
    useDevicePref: () => [null, () => undefined],
}));

afterEach(() => {
    vi.useRealTimers();
});

const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(BusinessZoneContext.Provider, { value: "America/Vancouver" }, children);

describe("the bell", () => {
    it("shows what syncs after the shell opened, though the shell stays mounted", () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const opened = new Date("2026-11-10T17:00:00Z");
        vi.setSystemTime(opened);
        feed.rows = [];
        const { result, rerender } = renderHook(
            () => useNotifications({ staffId: "st_owner", role: "owner" }),
            { wrapper },
        );
        expect(result.current.groups).toEqual([]);
        vi.setSystemTime(new Date(opened.getTime() + 5 * 60_000));
        feed.rows = [
            {
                id: "rff-pay_r",
                kind: "refund_failed",
                at: new Date(opened.getTime() + 2 * 60_000).toISOString(),
                client_id: "cl_1",
                client_name: "Ann",
                amount_cents: 1000,
                item_name: null,
                number: null,
                body: null,
                ref_id: "pay_1",
                starts_at: null,
            },
        ];
        rerender();
        const items = result.current.groups.flatMap((g) => g.items);
        expect(items.map((n) => [n.kind, n.link, n.linkId, n.read])).toEqual([
            ["refund_failed", "refunds", "pay_1", false],
        ]);
        expect(result.current.unread).toBe(1);
    });
});
