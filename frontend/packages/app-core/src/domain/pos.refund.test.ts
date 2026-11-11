// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { BusinessZoneContext } from "../datetime";
import { SALE_PAYMENTS_SQL, SALE_RECORD_SQL, useSaleDetail } from "./pos";

const replica = vi.hoisted(() => ({ payments: [] as Record<string, unknown>[] }));

const RECORD = {
    id: "ord_1",
    number: 1044,
    client_id: "cl_1",
    client_name: "Ann",
    client_phone: null,
    source: "pos",
    pickup_status: null,
    created_at: "2026-10-13T16:00:00Z",
    subtotal_cents: 4762,
    tax_total_cents: 238,
    total_cents: 5000,
    staff_id: "st_1",
    note: null,
    discount_kind: null,
    discount_value: null,
    discount_reason: null,
    receipt_phone: null,
    receipt_sent_at: null,
    status: "paid",
};

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string) => ({
        data:
            sql === SALE_RECORD_SQL ? [RECORD] : sql === SALE_PAYMENTS_SQL ? replica.payments : [],
        isLoading: false,
        error: null,
    }),
}));

vi.mock("./sync", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./sync")>()),
    useReplicaLoad: () => ({ state: "ready", retry: () => undefined }),
}));

const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(BusinessZoneContext.Provider, { value: "America/Vancouver" }, children);

const row = (
    id: string,
    kind: string,
    method: string,
    cents: number,
    status: string,
    parent: string | null = null,
) => ({
    id,
    kind,
    method,
    amount_cents: cents,
    tip_cents: 0,
    tip_split: null,
    status,
    paid_at: `2026-10-13T16:0${String(replica.payments.length)}:00Z`,
    credit_note: null,
    reason: null,
    tendered_cents: null,
    parent_payment_id: parent,
});

function detail() {
    return renderHook(() => useSaleDetail("ord_1", "owner"), { wrapper }).result.current.detail;
}

describe("refunding a sale from its panel", () => {
    it("targets the latest payment with money left, and offers nothing while a refund processes", () => {
        replica.payments = [];
        replica.payments.push(row("pay_card", "payment", "card", 3000, "succeeded"));
        replica.payments.push(row("pay_cash", "payment", "cash", 2000, "succeeded"));
        replica.payments.push(row("ref_cash", "refund", "cash", 2000, "succeeded", "pay_cash"));
        const partly = detail();
        expect(partly?.refundablePaymentId).toBe("pay_card");
        expect(partly?.actions.map((a) => a.key)).toContain("refund");
        expect(partly?.payments.map((p) => p.icon)).toEqual(["card", "dollar", "refresh"]);

        replica.payments.push(row("ref_card", "refund", "card", 3000, "pending", "pay_card"));
        const processing = detail();
        expect(processing?.refundablePaymentId).toBeNull();
        expect(processing?.actions.map((a) => a.key)).not.toContain("refund");
    });
});
