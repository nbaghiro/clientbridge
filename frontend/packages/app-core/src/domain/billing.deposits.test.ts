// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BusinessZoneContext } from "../datetime";
import { formatMoney } from "../format";
import { strings } from "../strings";
import { INVOICE_CREDITS_SQL, INVOICE_SQL, useInvoiceRecord } from "./billing";

const ZONE = "America/Vancouver";
const s = strings.billing;

type Row = Record<string, unknown>;

const replica = vi.hoisted((): { invoice: Row; credits: Row[] } => ({ invoice: {}, credits: [] }));

const invoice = (overrides: Record<string, unknown> = {}) => ({
    id: "inv_1",
    client_id: "cl_1",
    client_name: "Ann",
    client_phone: null,
    number: 7,
    charge_name: null,
    status: "sent",
    subtotal_cents: 7500,
    tax_total_cents: 375,
    total_cents: 7875,
    balance_cents: 7875,
    paid_cents: 0,
    due_once_sent_cents: null,
    tip_cents: 0,
    currency: "CAD",
    issued_at: "2026-10-01T12:00:00Z",
    due_at: "2026-10-31T12:00:00Z",
    paid_at: null,
    voided_at: null,
    pay_token: "tok",
    notes: null,
    discount_kind: null,
    discount_value: null,
    discount_reason: null,
    created_at: "2026-10-01T12:00:00Z",
    ...overrides,
});

const applied = (reversed: number) => ({
    id: "en_applied",
    event: "application",
    cents: 2500,
    occurred_at: "2026-10-01T12:00:00Z",
    method: null,
    reversed,
});

const reversal = {
    id: "en_reversal",
    event: "reversal",
    cents: -2500,
    occurred_at: "2026-10-02T12:00:00Z",
    method: null,
    reversed: 0,
};

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string) => ({
        data:
            sql === INVOICE_SQL
                ? [replica.invoice]
                : sql === INVOICE_CREDITS_SQL
                  ? replica.credits
                  : [],
        isLoading: false,
        error: null,
    }),
}));

const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(BusinessZoneContext.Provider, { value: ZONE }, children);

function record() {
    const rec = renderHook(() => useInvoiceRecord("inv_1", "https://pay.test"), { wrapper }).result
        .current;
    if (rec === null) throw new Error("the invoice record is missing");
    return rec;
}

const money = (cents: number) => formatMoney(cents, "CAD");

beforeEach(() => {
    replica.invoice = invoice();
    replica.credits = [];
});

describe("a visit deposit on an invoice", () => {
    it("pays the invoice down while it stays applied", () => {
        replica.invoice = invoice({ balance_cents: 5375, paid_cents: 2500 });
        replica.credits = [applied(0)];
        const rec = record();
        expect(rec.totals.slice(-2).map((t) => [t.label, t.cents])).toEqual([
            [s.depositApplied, 2500],
            [s.balanceDue, 5375],
        ]);
        expect(rec.timeline.map((t) => t.label)).toContain(s.event.depositApplied(money(2500)));
    });

    it("comes off the printed totals once refunded, and the history says so", () => {
        replica.credits = [applied(1), reversal];
        const rec = record();
        expect(rec.totals.map((t) => t.label)).not.toContain(s.depositApplied);
        expect(rec.totals.at(-1)).toMatchObject({ label: s.balanceDue, cents: 7875 });
        expect(rec.timeline.map((t) => [t.label, t.intent]).slice(-2)).toEqual([
            [s.event.depositApplied(money(2500)), "success"],
            [s.event.depositReturned(money(2500)), "danger"],
        ]);
    });

    it("leaves a voided invoice's history to its void entry", () => {
        replica.invoice = invoice({ status: "void", voided_at: reversal.occurred_at });
        replica.credits = [applied(1), reversal];
        const labels = record().timeline.map((t) => t.label);
        expect(labels).not.toContain(s.event.depositReturned(money(2500)));
        expect(labels.at(-1)).toBe(s.event.voided);
    });

    it("still says a deposit was refunded before the invoice was voided", () => {
        replica.invoice = invoice({ status: "void", voided_at: "2026-10-03T12:00:00Z" });
        replica.credits = [applied(1), reversal];
        expect(record().timeline.map((t) => t.label)).toContain(
            s.event.depositReturned(money(2500)),
        );
    });

    it("shows on a draft as the amount sending it takes off, matching its balance due", () => {
        replica.invoice = invoice({
            status: "draft",
            number: null,
            issued_at: null,
            due_at: null,
            pay_token: null,
            due_once_sent_cents: 5375,
        });
        const rec = record();
        expect(rec.totals.slice(-2).map((t) => [t.label, t.cents, t.kind])).toEqual([
            [s.depositHeld, 2500, "credit"],
            [s.balanceDue, 5375, "balance"],
        ]);
        expect(rec.facts[0]).toEqual({ label: s.balanceDue, value: money(5375) });
    });

    it("leaves a draft with no deposit paid ending at its total", () => {
        replica.invoice = invoice({
            status: "draft",
            number: null,
            issued_at: null,
            pay_token: null,
            due_once_sent_cents: 7875,
        });
        expect(record().totals.at(-1)).toMatchObject({ key: "total", cents: 7875 });
    });
});
