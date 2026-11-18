// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { BusinessZoneContext } from "../datetime";
import { strings } from "../strings";
import { usePaymentRecorder } from "./payments";

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: () => ({ data: [] }),
}));

const r = strings.billing.rec;
const TARGET = {
    invoiceId: "inv_1",
    label: strings.billing.invoiceNo(1729),
    clientId: "cl_1",
    clientPhone: "+16042892343",
    balanceCents: 5000,
};

function recordingApi(): ApiLike {
    return {
        get: <T>() => Promise.resolve({} as T),
        getText: () => Promise.resolve(""),
        post: <T>() =>
            Promise.resolve({ payment_id: "pay_1", status: "succeeded", balance_cents: 3000 } as T),
        patch: <T>() => Promise.resolve({} as T),
        delete: <T>() => Promise.resolve({} as T),
    };
}

describe("recording part of an invoice in cash", () => {
    it("names the invoice once, formats the phone and shows the new balance", async () => {
        const wrapper = ({ children }: { children: ReactNode }) =>
            createElement(BusinessZoneContext.Provider, { value: "America/Vancouver" }, children);
        const { result } = renderHook(() => usePaymentRecorder(recordingApi(), TARGET), {
            wrapper,
        });
        expect(result.current.receiptTo).toBe("(604) 289-2343");
        act(() => {
            result.current.setAmountMode("part");
            result.current.setAmount("20");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.done).not.toBeNull();
        });
        expect(result.current.done?.lines).toEqual([
            "Invoice #1729 has $30.00 left to pay.",
            r.receiptSent("(604) 289-2343"),
        ]);
        expect(result.current.balanceCents).toBe(3000);
        // another payment before the replica catches up starts from the server's balance
        act(() => {
            result.current.reset();
        });
        expect(result.current.balanceCents).toBe(3000);
        expect(result.current.amountCents).toBe(3000);
    });
});

describe("a payment whose answer was lost", () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(BusinessZoneContext.Provider, { value: "America/Vancouver" }, children);
    const partInCash = (recorder: { current: ReturnType<typeof usePaymentRecorder> }): void => {
        act(() => {
            recorder.current.setAmountMode("part");
            recorder.current.setAmount("15");
        });
        act(() => {
            recorder.current.submit();
        });
    };

    it("says it may have gone through, and a retry after reopening sends the same key", async () => {
        const keys: (string | undefined)[] = [];
        const api: ApiLike = {
            ...recordingApi(),
            post: <T>(_path: string, _body: unknown, opts?: { idempotencyKey?: string }) => {
                keys.push(opts?.idempotencyKey);
                return keys.length === 1
                    ? Promise.reject(new TypeError("Failed to fetch"))
                    : Promise.resolve({ status: "succeeded", balance_cents: 3500 } as T);
            },
        };
        const target = { ...TARGET, invoiceId: "inv_lost" };
        const first = renderHook(() => usePaymentRecorder(api, target), { wrapper });
        partInCash(first.result);
        await waitFor(() => {
            expect(first.result.current.error).toBe(r.unconfirmed);
        });
        first.unmount();

        const reopened = renderHook(() => usePaymentRecorder(api, target), { wrapper });
        partInCash(reopened.result);
        await waitFor(() => {
            expect(reopened.result.current.done).not.toBeNull();
        });
        expect(keys).toHaveLength(2);
        expect(keys[1]).toBe(keys[0]);
    });

    it("sends a fresh key for the same details once the lost payment reaches the replica", async () => {
        const keys: (string | undefined)[] = [];
        const api: ApiLike = {
            ...recordingApi(),
            post: <T>(_path: string, _body: unknown, opts?: { idempotencyKey?: string }) => {
                keys.push(opts?.idempotencyKey);
                return keys.length === 1
                    ? Promise.reject(new TypeError("Failed to fetch"))
                    : Promise.resolve({ status: "succeeded", balance_cents: 2000 } as T);
            },
        };
        const target = { ...TARGET, invoiceId: "inv_landed" };
        const first = renderHook(() => usePaymentRecorder(api, target), { wrapper });
        partInCash(first.result);
        await waitFor(() => {
            expect(first.result.current.error).toBe(r.unconfirmed);
        });
        first.unmount();

        const landed = { ...target, balanceCents: 3500 };
        const second = renderHook(() => usePaymentRecorder(api, landed), { wrapper });
        partInCash(second.result);
        await waitFor(() => {
            expect(second.result.current.done).not.toBeNull();
        });
        expect(keys).toHaveLength(2);
        expect(keys[1]).not.toBe(keys[0]);
    });

    it("starts a fresh attempt after the server refused one", async () => {
        const keys: (string | undefined)[] = [];
        const refused = Object.assign(new Error("POST → 409"), { status: 409, code: null });
        const api: ApiLike = {
            ...recordingApi(),
            post: <T>(_path: string, _body: unknown, opts?: { idempotencyKey?: string }) => {
                keys.push(opts?.idempotencyKey);
                return keys.length === 1
                    ? Promise.reject(refused)
                    : Promise.resolve({ status: "succeeded", balance_cents: 3500 } as T);
            },
        };
        const target = { ...TARGET, invoiceId: "inv_refused" };
        const { result } = renderHook(() => usePaymentRecorder(api, target), { wrapper });
        partInCash(result);
        await waitFor(() => {
            expect(result.current.error).toBe(r.error);
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.done).not.toBeNull();
        });
        expect(keys[1]).not.toBe(keys[0]);
    });
});
