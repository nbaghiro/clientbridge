// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { BusinessZoneContext, CALENDAR, formatShortDay } from "../datetime";
import { strings } from "../strings";
import { BUSINESS_ID_SQL } from "./business";
import { payoutWhen, usePayouts } from "./payouts";

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string) => ({
        data: sql === BUSINESS_ID_SQL ? [{ id: "bz_one" }] : [],
        isLoading: false,
    }),
}));

vi.mock("@powersync/react", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@powersync/react")>()),
    usePowerSync: () => ({
        registerListener: () => () => undefined,
        currentStatus: { hasSynced: true },
    }),
}));

describe("payoutWhen", () => {
    const row = {
        id: "jrn_one",
        amount_cents: 1890,
        occurred_at: "2026-10-27 18:00:00+00",
    };

    it("shows Stripe's arrival day in a zone where its midnight UTC is still the day before", () => {
        const when = payoutWhen(
            { ...row, arrival_at: "2026-10-28 00:00:00+00", status: "paid" },
            "America/Vancouver",
        );
        expect(when).toBe(
            strings.payouts.arrived(formatShortDay(new Date(Date.UTC(2026, 9, 28)), CALENDAR)),
        );
    });

    it("shows a payout without an arrival on the business's own day", () => {
        const when = payoutWhen(
            { ...row, occurred_at: "2026-10-28 02:00:00+00", arrival_at: null, status: "pending" },
            "America/Vancouver",
        );
        expect(when).toBe(
            strings.payouts.expected(formatShortDay(new Date(Date.UTC(2026, 9, 27)), CALENDAR)),
        );
    });

    it("dates a canceled payout by the business day it was created, and a returned one by its arrival", () => {
        const arrival = "2026-10-30 00:00:00+00";
        const zone = "America/Vancouver";
        const created = { ...row, occurred_at: "2026-10-28 02:00:00+00", arrival_at: arrival };
        const canceled = payoutWhen({ ...created, status: "canceled" }, zone);
        const failed = payoutWhen({ ...created, status: "failed" }, zone);
        expect([canceled, failed]).toEqual([
            strings.payouts.canceled(formatShortDay(new Date(Date.UTC(2026, 9, 27, 12)), CALENDAR)),
            strings.payouts.returned(formatShortDay(new Date(Date.UTC(2026, 9, 30)), CALENDAR)),
        ]);
    });
});

describe("usePayouts", () => {
    it("re-reads the account from Stripe after account management, then the payout bank", async () => {
        const asked: string[] = [];
        let foreign = true;
        const api: ApiLike = {
            get: <T>(path: string) => {
                asked.push(`GET ${path}`);
                return Promise.resolve({
                    payouts: [],
                    next_cursor: null,
                    foreign_bank: foreign,
                } as T);
            },
            getText: () => Promise.resolve(""),
            post: <T>(path: string) => {
                asked.push(`POST ${path}`);
                foreign = false;
                return Promise.resolve({} as T);
            },
            patch: <T>() => Promise.resolve({} as T),
            delete: <T>() => Promise.resolve({} as T),
        };
        const wrapper = ({ children }: { children: ReactNode }) =>
            createElement(BusinessZoneContext.Provider, { value: "America/Toronto" }, children);
        const { result } = renderHook(() => usePayouts(api), { wrapper });
        await waitFor(() => {
            expect(result.current.foreignBank).toBe(true);
        });
        act(() => {
            result.current.recheckBank();
        });
        await waitFor(() => {
            expect(result.current.historyLoad.state).toBe("empty");
            expect(result.current.foreignBank).toBe(false);
        });
        expect(asked).toEqual([
            "GET /v1/connect/payouts",
            "POST /v1/connect/refresh",
            "GET /v1/connect/payouts",
        ]);
    });
    it("pages payouts and a payout's transactions by Stripe's cursors, and back to the newest", async () => {
        const asked: string[] = [];
        const payout = (id: string) => ({
            id,
            amount_cents: 1000,
            status: "paid",
            occurred_at: "2026-10-27 18:00:00+00",
            arrival_at: "2026-10-28 00:00:00+00",
        });
        const transaction = (id: string) => ({
            id,
            source: null,
            kind: "charge",
            amount_cents: 2000,
            fee_cents: 88,
            net_cents: 1912,
            currency: "CAD",
            occurred_at: "2026-10-27 18:00:00+00",
        });
        const api: ApiLike = {
            get: <T>(path: string) => {
                asked.push(path);
                const older = path.includes("after=");
                const body = path.includes("/transactions")
                    ? {
                          status: "available",
                          transactions: [transaction(older ? "txn_older" : "txn_newer")],
                          next_cursor: older ? null : "txn_newer",
                      }
                    : {
                          payouts: [payout(older ? "po_older" : "po_newer")],
                          next_cursor: older ? null : "po_newer",
                          foreign_bank: false,
                      };
                return Promise.resolve(body as T);
            },
            getText: () => Promise.resolve(""),
            post: <T>() => Promise.resolve({} as T),
            patch: <T>() => Promise.resolve({} as T),
            delete: <T>() => Promise.resolve({} as T),
        };
        const wrapper = ({ children }: { children: ReactNode }) =>
            createElement(BusinessZoneContext.Provider, { value: "America/Toronto" }, children);
        const { result } = renderHook(() => usePayouts(api), { wrapper });
        const shown = () => ({
            payouts: result.current.payouts.map((p) => p.id),
            contents: result.current.contents.rows.map((r) => r.id),
            older: result.current.next !== null,
            newer: result.current.previous !== null,
        });
        const first = "/v1/connect/payouts/po_newer/transactions";
        const firstPageReads = () => asked.filter((path) => path === first).length;
        await waitFor(() => {
            expect(shown()).toEqual({
                payouts: ["po_newer"],
                contents: [],
                older: true,
                newer: false,
            });
        });
        // nothing is read from Stripe for a payout until it is opened
        expect(firstPageReads()).toBe(0);
        act(() => {
            result.current.select("po_newer");
        });
        await waitFor(() => {
            expect(result.current.contents.rows.map((r) => r.id)).toEqual(["txn_newer"]);
        });
        act(() => {
            result.current.select("po_newer");
        });
        // opened again on the page it already shows, the payout keeps it without a new read
        expect(result.current.contents.rows.map((r) => r.id)).toEqual(["txn_newer"]);
        expect(firstPageReads()).toBe(1);
        act(() => {
            result.current.contents.next?.();
        });
        await waitFor(() => {
            expect(result.current.contents.rows.map((r) => r.id)).toEqual(["txn_older"]);
        });
        expect(result.current.contents.next).toBeNull();
        act(() => {
            result.current.select("po_newer");
        });
        // opening a payout again starts at its first transactions
        await waitFor(() => {
            expect(result.current.contents.rows.map((r) => r.id)).toEqual(["txn_newer"]);
        });
        act(() => {
            result.current.contents.next?.();
        });
        await waitFor(() => {
            expect(result.current.contents.rows.map((r) => r.id)).toEqual(["txn_older"]);
        });
        act(() => {
            result.current.next?.();
        });
        // another payout's transactions start from their first page
        await waitFor(() => {
            expect(shown()).toEqual({
                payouts: ["po_older"],
                contents: ["txn_newer"],
                older: false,
                newer: true,
            });
        });
        act(() => {
            result.current.previous?.();
        });
        await waitFor(() => {
            expect(shown()).toEqual({
                payouts: ["po_newer"],
                contents: ["txn_newer"],
                older: true,
                newer: false,
            });
        });
        expect(asked).toContain("/v1/connect/payouts?after=po_newer");
        expect(asked).toContain("/v1/connect/payouts/po_newer/transactions?after=txn_newer");
        expect(asked).toContain("/v1/connect/payouts/po_older/transactions");
    });
});
