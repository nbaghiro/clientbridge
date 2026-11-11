// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { BusinessZoneContext } from "../datetime";
import { strings } from "../strings";
import { INVOICE_SQL, printedInvoice, useInvoiceRecord } from "./billing";
import { INVOICE_PAYMENTS_SQL } from "./payments";
import { type Letterhead, shortDate } from "./printing";

const replica = vi.hoisted(() => ({ status: "paid" }));
const ZONE = "America/Vancouver";
const s = strings.billing;

const invoice = () => ({
    id: "inv_1",
    client_id: "cl_1",
    client_name: "Ann",
    client_phone: null,
    number: 7,
    status: replica.status,
    subtotal_cents: 5714,
    tax_total_cents: 286,
    total_cents: 6000,
    balance_cents: 0,
    paid_cents: 6000,
    tip_cents: 0,
    currency: "CAD",
    issued_at: "2026-10-01T12:00:00Z",
    due_at: null,
    paid_at: "2026-10-02T12:00:00Z",
    voided_at: null,
    pay_token: "tok",
    notes: null,
    discount_kind: null,
    discount_value: null,
    discount_reason: null,
    created_at: "2026-10-01T12:00:00Z",
});

const pay = (
    id: string,
    kind: string,
    cents: number,
    status: string,
    parent: string | null = null,
    note: string | null = null,
) => ({
    id,
    kind,
    parent_payment_id: parent,
    amount_cents: cents,
    currency: "CAD",
    status,
    method: "card",
    created_at: "2026-10-03T12:00:00Z",
    paid_at: "2026-10-03T12:00:00Z",
    reference: null,
    note: null,
    tendered_cents: null,
    tip_cents: 0,
    credit_note: note,
});

const PAYMENTS = [
    pay("pay_a", "payment", 3000, "succeeded"),
    pay("ref_a", "refund", 3000, "succeeded", "pay_a", "CN-7-1"),
    pay("pay_b", "payment", 2000, "succeeded"),
    pay("ref_b", "refund", 500, "pending", "pay_b"),
    pay("pay_c", "payment", 1000, "succeeded"),
    pay("ref_c", "refund", 400, "failed", "pay_c"),
];

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string) => ({
        data: sql === INVOICE_SQL ? [invoice()] : sql === INVOICE_PAYMENTS_SQL ? PAYMENTS : [],
        isLoading: false,
        error: null,
    }),
}));

const LETTERHEAD: Letterhead = {
    name: "Birch Studio",
    tagline: null,
    brandColor: null,
    email: null,
    gstHstNumber: null,
    qstNumber: null,
};

const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(BusinessZoneContext.Provider, { value: ZONE }, children);

function record() {
    const rec = renderHook(() => useInvoiceRecord("inv_1", "https://pay.test"), { wrapper }).result
        .current;
    if (rec === null) throw new Error("the invoice record is missing");
    return rec;
}

describe("an invoice's refunds", () => {
    it("name each credit note, and offer a refund only on a payment with money left and none processing", () => {
        const rec = record();
        expect(rec.payments.map((p) => [p.id, p.label, p.refundable])).toEqual([
            ["pay_a", expect.any(String), false],
            ["ref_a", s.creditNote("CN-7-1"), false],
            ["pay_b", expect.any(String), false],
            ["ref_b", s.refundBadge, false],
            ["pay_c", expect.any(String), true],
        ]);
        expect(rec.totals.slice(-2).map((t) => [t.key, t.label, t.cents])).toEqual([
            ["balance", s.balanceDue, 0],
            ["ref_a", s.refundedOn("CN-7-1", shortDate("2026-10-03T12:00:00Z", ZONE)), 3000],
        ]);
    });

    it("stamp the printed invoice Refunded once refunded in full, and Paid before", () => {
        replica.status = "paid";
        expect(printedInvoice(record(), LETTERHEAD, "#000").stamp).toBe(strings.printing.paidStamp);
        replica.status = "refunded";
        expect(printedInvoice(record(), LETTERHEAD, "#000").stamp).toBe(
            strings.printing.refundedStamp,
        );
    });
});
