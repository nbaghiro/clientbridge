// @vitest-environment happy-dom
import { renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, createElement } from "react";
import { describe, expect, it } from "vitest";

import type { ApiLike } from "../api";
import { BusinessZoneContext } from "../datetime";
import { strings } from "../strings";
import { type RefundSummary, useRefundComposer } from "./refunds";

const s = strings.refunds;

const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(BusinessZoneContext.Provider, { value: "America/Vancouver" }, children);

const payment: RefundSummary["payment"] = {
    id: "pay_1",
    client_id: "cl_1",
    client_name: "Ann",
    client_phone: null,
    kind: "payment",
    method: "card",
    provider: "stripe",
    amount_cents: 2000,
    paid_at: "2026-10-01T12:00:00Z",
    created_at: "2026-10-01T12:00:00Z",
    invoice_number: null,
    charge_name: null,
    order_number: 5,
    booking_id: null,
    gift_code: null,
    package_name: null,
    refunded_cents: 0,
    fee_cents: 88,
    dispute_status: "needs_response",
    dispute_respond_by: "2026-10-20T12:00:00Z",
};

const summary = (state: RefundSummary["state"]): RefundSummary => ({
    payment,
    client: "Ann",
    subject: s.subject.sale(5),
    method: s.method.card,
    when: "",
    state,
    stateLabel: s.statusLabel[state],
    intent: "neutral",
    leftCents: 2000,
});

describe("a refund panel left open while a dispute is decided", () => {
    it("reloads the preview when the dispute is won, so the block lifts", async () => {
        const answers = ["payment_disputed", null];
        const api: ApiLike = {
            get: <T>() =>
                Promise.resolve({
                    payment_id: "pay_1",
                    amount_cents: 2000,
                    refunded_cents: 0,
                    left_cents: 2000,
                    fee_cents: 88,
                    refund_cents: 2000,
                    whole_only: false,
                    blocked: answers.shift() ?? null,
                    by_hand: false,
                    next_credit_note: "CN-5-1",
                    parts: [],
                } as T),
            getText: () => Promise.resolve(""),
            post: <T>() => Promise.resolve({} as T),
            patch: <T>() => Promise.resolve({} as T),
            delete: <T>() => Promise.resolve({} as T),
        };
        const { result, rerender } = renderHook(
            ({ state }: { state: RefundSummary["state"] }) =>
                useRefundComposer(api, summary(state), []),
            { wrapper, initialProps: { state: "disputed" } },
        );
        await waitFor(() => {
            expect(result.current.blocked).toBe(s.blocked.payment_disputed);
        });
        rerender({ state: "paid" });
        await waitFor(() => {
            expect(result.current.blocked).toBeNull();
        });
    });
});

describe("the amount choice on a refund", () => {
    const previewing = (wholeOnly: boolean): ApiLike => ({
        get: <T>() =>
            Promise.resolve({
                payment_id: "pay_1",
                amount_cents: 2000,
                refunded_cents: 0,
                left_cents: 2000,
                fee_cents: 88,
                refund_cents: 2000,
                whole_only: wholeOnly,
                blocked: null,
                by_hand: false,
                next_credit_note: "CN-5-1",
                parts: [],
            } as T),
        getText: () => Promise.resolve(""),
        post: <T>() => Promise.resolve({} as T),
        patch: <T>() => Promise.resolve({} as T),
        delete: <T>() => Promise.resolve({} as T),
    });

    it("offers all or part of what's left", async () => {
        const { result } = renderHook(
            () => useRefundComposer(previewing(false), summary("paid"), []),
            { wrapper },
        );
        await waitFor(() => {
            expect(result.current.preview.data).not.toBeNull();
        });
        expect(result.current.modes.map((m) => m.key)).toEqual(["full", "part"]);
    });

    it("offers no part refund on a payment refunded in full only", async () => {
        const { result } = renderHook(
            () => useRefundComposer(previewing(true), summary("paid"), []),
            { wrapper },
        );
        await waitFor(() => {
            expect(result.current.wholeOnly).toBe(s.wholeOnly.purchase);
        });
        expect(result.current.modes.map((m) => m.key)).toEqual(["full"]);
    });

    it("says why a deposit is refunded in full only, not that it's a purchase", async () => {
        const deposit = { ...summary("paid"), payment: { ...payment, kind: "deposit" } };
        const { result } = renderHook(() => useRefundComposer(previewing(true), deposit, []), {
            wrapper,
        });
        await waitFor(() => {
            expect(result.current.wholeOnly).toBe(s.wholeOnly.deposit);
        });
    });

    it("offers a part refund with no notice when the payment allows one", async () => {
        const { result } = renderHook(
            () => useRefundComposer(previewing(false), summary("paid"), []),
            { wrapper },
        );
        await waitFor(() => {
            expect(result.current.preview.data).not.toBeNull();
        });
        expect(result.current.wholeOnly).toBeNull();
    });
});
