// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { BusinessZoneContext } from "../datetime";
import { useLoad } from "../hooks";
import { TODAY_PAYMENTS_SQL, useOwnerToday } from "./today";

let payments: { id: string; kind: string }[] = [];
let paymentsLoading = false;

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string) =>
        sql === TODAY_PAYMENTS_SQL
            ? { data: payments, isLoading: paymentsLoading }
            : { data: [], isLoading: false },
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
    gst_hst_filing_due: null;
}

const summary = (cents: number): Summary => ({
    today_revenue_cents: cents,
    awaiting_payment_cents: 0,
    gst_hst_set_aside_cents: 0,
    gst_hst_filing_due: null,
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
