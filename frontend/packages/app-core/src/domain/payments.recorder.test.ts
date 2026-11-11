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
