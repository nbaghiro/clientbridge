// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { BusinessZoneContext } from "../datetime";
import { strings } from "../strings";
import { INVOICE_SQL, printedInvoice, useInvoiceRecord } from "./billing";
import type { Letterhead } from "./printing";

const replica = vi.hoisted((): { number: number | null; chargeName: string | null } => ({
    number: null,
    chargeName: "Monthly Daycare",
}));

const invoice = () => ({
    id: "inv_1",
    client_id: "cl_1",
    client_name: "Ann",
    client_phone: null,
    number: replica.number,
    charge_name: replica.chargeName,
    status: "paid",
    subtotal_cents: 32000,
    tax_total_cents: 1600,
    total_cents: 33600,
    balance_cents: 0,
    paid_cents: 33600,
    tip_cents: 0,
    currency: "CAD",
    issued_at: "2026-11-19T17:00:00Z",
    due_at: null,
    paid_at: "2026-11-19T17:00:00Z",
    voided_at: null,
    pay_token: replica.number === null ? null : "tok",
    notes: null,
    discount_kind: null,
    discount_value: null,
    discount_reason: null,
    created_at: "2026-11-19T17:00:00Z",
});

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string) => ({
        data: sql === INVOICE_SQL ? [invoice()] : [],
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
    createElement(BusinessZoneContext.Provider, { value: "America/Vancouver" }, children);

function record() {
    const rec = renderHook(() => useInvoiceRecord("inv_1", "https://pay.test"), { wrapper }).result
        .current;
    if (rec === null) throw new Error("the invoice record is missing");
    return rec;
}

describe("a membership renewal's invoice", () => {
    it("goes by its plan, says it was issued rather than sent, and never reads as a draft", () => {
        replica.number = null;
        replica.chargeName = "Monthly Daycare";
        const rec = record();
        expect(rec.title).toBe("Monthly Daycare");
        expect(rec.timeline.find((t) => t.key === "sent")?.label).toBe(
            strings.billing.event.issued,
        );
        const doc = printedInvoice(rec, LETTERHEAD, "#000");
        expect([doc.reference, doc.number, doc.meta[0]?.value]).toEqual([
            "Monthly Daycare",
            "Monthly Daycare",
            "Monthly Daycare",
        ]);
        // the plan is printed as what was charged for, never in the invoice number's place
        expect(doc.meta[0]?.label).toBe(strings.printing.plan);
        expect(doc.heading).toBe(strings.printing.headingFor(doc.title, "Monthly Daycare"));
    });

    it("leaves a numbered invoice its number and its sent event", () => {
        replica.number = 7;
        replica.chargeName = null;
        const rec = record();
        expect(rec.title).toBe(strings.billing.invoiceNo(7));
        expect(rec.timeline.find((t) => t.key === "sent")?.label).toBe(strings.billing.event.sent);
        const doc = printedInvoice(rec, LETTERHEAD, "#000");
        expect(doc.reference).toBe(strings.printing.reference("7"));
        expect(doc.meta[0]?.label).toBe(strings.printing.invoiceNumber);
        expect(doc.heading).toBe(strings.printing.heading(doc.title, doc.reference));
    });
});
