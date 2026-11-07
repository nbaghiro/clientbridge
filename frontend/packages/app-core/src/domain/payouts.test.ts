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
});
