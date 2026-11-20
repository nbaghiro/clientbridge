// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { BusinessZoneContext } from "../datetime";
import { useLoad } from "../hooks";
import { TODAY_PAYMENTS_SQL, TODAY_RETURNS_SQL, TODAY_TAX_SQL, useOwnerToday } from "./today";

let payments: { id: string; kind: string }[] = [];
let paymentsLoading = false;
let taxes: { id: string; balance_cents: number }[] = [];
let returns: { journal_id: string }[] = [];

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string) =>
        sql === TODAY_PAYMENTS_SQL
            ? { data: payments, isLoading: paymentsLoading }
            : {
                  data: sql === TODAY_TAX_SQL ? taxes : sql === TODAY_RETURNS_SQL ? returns : [],
                  isLoading: false,
              },
}));

vi.mock("./sync", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./sync")>()),
    useReplicaLoad: (sources: Parameters<typeof useLoad>[0], empty: boolean) =>
        useLoad(sources, empty),
}));

vi.mock("./gettingPaid", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./gettingPaid")>()),
    useAccountNotices: () => null,
}));

interface Summary {
    today_revenue_cents: number;
    awaiting_payment_cents: number;
    gst_hst_set_aside_cents: number;
    gst_hst_filing_due: string | null;
    gst_hst_filing_due_cents: number;
}

const summary = (cents: number, setAsideCents = 0): Summary => ({
    today_revenue_cents: cents,
    awaiting_payment_cents: 0,
    gst_hst_set_aside_cents: setAsideCents,
    gst_hst_filing_due: null,
    gst_hst_filing_due_cents: 0,
});

function summaryApi(answer: () => Promise<Summary>): ApiLike & { reads: number } {
    const api = {
        reads: 0,
        get: <T>() => {
            api.reads += 1;
            return answer() as Promise<T>;
        },
        getText: () => Promise.resolve(""),
        post: <T>() => Promise.resolve({} as T),
        patch: <T>() => Promise.resolve({} as T),
        delete: <T>() => Promise.resolve({} as T),
    };
    return api;
}

const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(BusinessZoneContext.Provider, { value: "America/Vancouver" }, children);

afterEach(() => {
    payments = [];
    paymentsLoading = false;
    taxes = [];
    returns = [];
});

describe("Today's money figures", () => {
    it("reads the server's sums again when a payment reaches this device, not on the first load", async () => {
        let cents = 1000;
        const api = summaryApi(() => Promise.resolve(summary(cents)));
        paymentsLoading = true;
        const { result, rerender } = renderHook(() => useOwnerToday(api, null), {
            wrapper,
        });
        paymentsLoading = false;
        payments = [{ id: "pay_1", kind: "payment" }];
        rerender();
        await waitFor(() => {
            expect(result.current.moneyLoad.state).toBe("ready");
        });
        expect(api.reads).toBe(1);
        expect(result.current.money.collectedCents).toBe(1000);

        cents = 3000;
        payments = [...payments, { id: "pay_2", kind: "payment" }];
        rerender();
        await waitFor(() => {
            expect(result.current.money.collectedCents).toBe(3000);
        });
        expect(api.reads).toBe(2);
        expect(result.current.moneyLoad.state).toBe("ready");
    });

    it("reads the server's sums again when a filed return moves the tax set aside", async () => {
        let setAside = 1200;
        const api = summaryApi(() => Promise.resolve(summary(0, setAside)));
        taxes = [{ id: "a_gst", balance_cents: -1200 }];
        const { result, rerender } = renderHook(() => useOwnerToday(api, null), { wrapper });
        await waitFor(() => {
            expect(result.current.money.setAsideCents).toBe(1200);
        });

        setAside = 0;
        taxes = [{ id: "a_gst", balance_cents: 0 }];
        rerender();
        await waitFor(() => {
            expect(result.current.money.setAsideCents).toBe(0);
        });
        expect(api.reads).toBe(2);
    });

    it("reads the server's sums again when a $0 return is recorded, though no balance moves", async () => {
        let due = "2026-10-31";
        const api = summaryApi(() => Promise.resolve({ ...summary(0), gst_hst_filing_due: due }));
        taxes = [{ id: "a_gst", balance_cents: 0 }];
        const { result, rerender } = renderHook(() => useOwnerToday(api, null), { wrapper });
        await waitFor(() => {
            expect(result.current.money.filingDue).not.toBeNull();
        });
        const before = result.current.money.filingDue?.getTime();
        expect(api.reads).toBe(1);

        due = "2027-01-31";
        returns = [{ journal_id: "jr_nil" }];
        rerender();
        await waitFor(() => {
            expect(result.current.money.filingDue?.getTime()).not.toBe(before);
        });
        expect(api.reads).toBe(2);
    });

    it("settles when a payment arrives while the first read is still out", async () => {
        const pending: ((value: Summary) => void)[] = [];
        const api = summaryApi(
            () =>
                new Promise<Summary>((resolve) => {
                    pending.push(resolve);
                }),
        );
        const { result, rerender } = renderHook(() => useOwnerToday(api, null), {
            wrapper,
        });
        payments = [{ id: "pay_1", kind: "payment" }];
        rerender();
        await waitFor(() => {
            expect(api.reads).toBe(2);
        });
        await act(async () => {
            pending[0]?.(summary(1000));
            pending[1]?.(summary(2000));
            await Promise.resolve();
        });
        await waitFor(() => {
            expect(result.current.moneyLoad.state).toBe("ready");
        });
        expect(result.current.money.collectedCents).toBe(2000);
    });
});
