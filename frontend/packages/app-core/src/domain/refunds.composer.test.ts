// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiLike } from "../api";
import { BusinessZoneContext } from "../datetime";
import { formatMoney } from "../format";
import { strings } from "../strings";
import { type RefundRow, type RefundSummary, useRefundComposer } from "./refunds";

afterEach(cleanup);

const s = strings.refunds;

const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(BusinessZoneContext.Provider, { value: "America/Vancouver" }, children);

function summary(phone: string | null): RefundSummary {
    return {
        payment: {
            id: "pay_1",
            client_id: "cl_1",
            client_name: "Ann",
            client_phone: phone,
            kind: "payment",
            method: "card",
            provider: "stripe",
            amount_cents: 5000,
            paid_at: "2026-10-01T12:00:00Z",
            created_at: "2026-10-01T12:00:00Z",
            invoice_number: 7,
            charge_name: null,
            order_number: null,
            booking_id: null,
            gift_code: null,
            package_name: null,
            refunded_cents: 0,
            fee_cents: 175,
            dispute_status: null,
            dispute_respond_by: null,
        },
        client: "Ann",
        subject: "Invoice #7",
        method: "Card",
        when: "Oct 1, 2026",
        state: "paid",
        stateLabel: s.statusLabel.paid,
        intent: "success",
        leftCents: 5000,
    };
}

const refund = (id: string, status: string, credit: string | null): RefundRow => ({
    id,
    parent_payment_id: "pay_1",
    amount_cents: 1000,
    paid_at: "2026-10-02T12:00:00Z",
    created_at: "2026-10-02T12:00:00Z",
    reason: "service",
    credit_note: credit,
    status,
    client_name: "Ann",
    invoice_number: 7,
    charge_name: null,
    order_number: null,
    gift_code: null,
    package_name: null,
    booking_id: null,
});

const PREVIEW = {
    payment_id: "pay_1",
    amount_cents: 5000,
    refunded_cents: 0,
    left_cents: 5000,
    fee_cents: 175,
    refund_cents: 5000,
    whole_only: false,
    blocked: null,
    by_hand: false,
    next_credit_note: "CN-7-2",
    parts: [],
};

function api(post: ApiLike["post"], preview: object = PREVIEW): ApiLike {
    return {
        get: vi.fn(() => Promise.resolve(preview)) as ApiLike["get"],
        getText: vi.fn(),
        post,
        patch: vi.fn(),
        delete: vi.fn(),
    };
}

describe("the refund composer", () => {
    it("names a refund that failed or is still processing, not as refunded", () => {
        const rows = [
            refund("r1", "succeeded", "CN-7-1"),
            refund("r2", "failed", "CN-7-2"),
            refund("r3", "pending", null),
        ];
        const { result } = renderHook(
            () => useRefundComposer(api(vi.fn()), summary("+12505550100"), rows),
            { wrapper },
        );
        const amount = formatMoney(1000, "CAD");
        expect(result.current.history.slice(1).map((h) => [h.label, h.intent])).toEqual([
            [`${s.refundEvent("CN-7-1")} · −${amount}`, "neutral"],
            [`${s.failedEvent} · ${amount}`, "danger"],
            [`${s.pendingEvent} · ${amount}`, "warning"],
        ]);
    });

    it("closes the form on a payment whose bank turned down an earlier refund", async () => {
        const refused = { ...PREVIEW, blocked: "refund_refused", refund_cents: 0 };
        const rows = [refund("r1", "failed", "CN-7-1")];
        const { result } = renderHook(
            () => useRefundComposer(api(vi.fn(), refused), summary("+12505550100"), rows),
            { wrapper },
        );
        await waitFor(() => {
            expect(result.current.blocked).toBe(s.blocked.refund_refused);
        });
        expect(result.current.open).toBe(false);
    });

    it("holds the form until the refund it issued syncs, and drops its notice if it fails later", async () => {
        const post = vi.fn(() =>
            Promise.resolve({ refund_id: "r9", status: "succeeded", credit_note: "CN-7-2" }),
        );
        const sum = summary("+12505550100");
        const { result, rerender } = renderHook(
            ({ rows }) => useRefundComposer(api(post as ApiLike["post"]), sum, rows),
            { wrapper, initialProps: { rows: [] as RefundRow[] } },
        );
        await waitFor(() => {
            expect(result.current.preview.isLoading).toBe(false);
        });
        expect(result.current.open).toBe(true);
        act(() => {
            result.current.submit();
        });
        const done = s.refundedDone(formatMoney(5000, "CAD"), "CN-7-2");
        await waitFor(() => {
            expect(result.current.issued).toBe(done);
        });
        expect(result.current.open).toBe(false);
        const synced = { ...refund("r9", "succeeded", "CN-7-2"), amount_cents: 5000 };
        rerender({ rows: [synced] });
        expect([result.current.open, result.current.issued]).toEqual([true, done]);
        rerender({ rows: [{ ...synced, status: "pending" }] });
        expect([result.current.open, result.current.issued, result.current.blocked]).toEqual([
            false,
            s.refundPending,
            null,
        ]);
        rerender({ rows: [{ ...synced, status: "failed" }] });
        expect([result.current.open, result.current.issued]).toEqual([true, null]);
    });

    it("texts the credit note only to a client with a phone", async () => {
        const post = vi.fn(() =>
            Promise.resolve({ refund_id: "r9", status: "succeeded", credit_note: "CN-7-2" }),
        );
        for (const [phone, sent] of [
            ["+12505550100", true],
            [null, false],
        ] as const) {
            post.mockClear();
            const { result } = renderHook(
                () => useRefundComposer(api(post as ApiLike["post"]), summary(phone), []),
                { wrapper },
            );
            expect(result.current.canNotify).toBe(sent);
            await waitFor(() => {
                expect(result.current.preview.isLoading).toBe(false);
            });
            act(() => {
                result.current.submit();
            });
            await waitFor(() => {
                expect(result.current.issued).toBe(
                    s.refundedDone(formatMoney(5000, "CAD"), "CN-7-2"),
                );
            });
            expect(post).toHaveBeenCalledWith(
                "/v1/payments/pay_1/refund",
                { amount_cents: 5000, reason: "service", notify: sent },
                expect.anything(),
            );
            cleanup();
        }
    });
});
