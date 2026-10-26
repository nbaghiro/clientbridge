import { randomUUID } from "node:crypto";
import { strings } from "@clientbridge/app-core/public";
import { expect, type Page } from "@playwright/test";
import { bookingApi } from "./bookings";
import { createClient, type ClientFixture } from "./clients";
import { select } from "./db";
import { requireLocalMail } from "./evidence";
import { navigate } from "./session";

export interface RefundFixture {
    client: ClientFixture;
    invoiceId: string;
    number: number;
    paymentId: string;
}

export interface RefundEvidence {
    payments: {
        id: string;
        kind: string;
        status: string;
        method: string;
        provider: string;
        parent_payment_id: string | null;
        amount_cents: number;
        credit_note: string | null;
    }[];
    entries: {
        journal_id: string;
        event: string;
        source_id: string;
        amount_cents: number;
        category: string;
        code: string | null;
    }[];
}

export async function refundEvidence(invoiceId: string): Promise<RefundEvidence> {
    return {
        payments: await select<RefundEvidence["payments"][number]>`
            SELECT id, kind, status, method, provider, parent_payment_id, amount_cents,
                credit_note
            FROM payments WHERE invoice_id = ${invoiceId} ORDER BY created_at, id`,
        entries: await select<RefundEvidence["entries"][number]>`
            SELECT e.journal_id, e.event, e.source_id, e.amount_cents, a.category, a.code
            FROM entries e JOIN accounts a ON a.id = e.account_id
            WHERE e.subject_type = 'invoice' AND e.subject_id = ${invoiceId}
            ORDER BY e.journal_id, e.leg`,
    };
}

export async function createCashRefundFixture(page: Page): Promise<RefundFixture> {
    requireLocalMail();
    const api = bookingApi();
    const client = await createClient(page);
    const headers = { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() };
    const issued = await page.request.post(`${api}/v1/invoices`, {
        headers,
        data: {
            client_id: client.id,
            send: true,
            lines: [
                {
                    description: "Full grooming appointment",
                    quantity: 1,
                    unit_amount_cents: 10000,
                    tax_class: "standard",
                },
            ],
        },
    });
    expect(issued.status(), await issued.text()).toBe(201);
    const invoice = (await issued.json()) as {
        id: string;
        number: number;
        subtotal_cents: number;
        tax_total_cents: number;
        total_cents: number;
    };
    expect(invoice).toMatchObject({
        subtotal_cents: 10000,
        tax_total_cents: 1200,
        total_cents: 11200,
    });
    const paid = await page.request.post(`${api}/v1/invoices/${invoice.id}/payments`, {
        headers: { ...headers, "Idempotency-Key": randomUUID() },
        data: { method: "cash", amount_cents: 11200, tendered_cents: 11200, send_receipt: false },
    });
    expect(paid.status(), await paid.text()).toBe(201);
    const payment = (await paid.json()) as { payment_id: string; status: string };
    expect(payment.status).toBe("succeeded");
    return { client, invoiceId: invoice.id, number: invoice.number, paymentId: payment.payment_id };
}

export async function openRefund(page: Page, fixture: Pick<RefundFixture, "client" | "paymentId">) {
    await navigate(page, `/payments/refunds?open=${fixture.paymentId}`);
    const panel = page.getByRole("complementary", { name: fixture.client.name, exact: true });
    await expect(
        panel.getByRole("heading", { name: fixture.client.name, exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    return panel;
}

export function expectCashRefunds(
    evidence: RefundEvidence,
    fixture: RefundFixture,
    count: number,
): void {
    const refunds = evidence.payments.filter((payment) => payment.kind === "refund");
    expect(refunds).toHaveLength(count);
    expect(evidence.payments).toHaveLength(count + 1);
    for (const [index, refund] of refunds.entries()) {
        expect(refund).toMatchObject({
            status: "succeeded",
            method: "cash",
            provider: "manual",
            parent_payment_id: fixture.paymentId,
            amount_cents: 5600,
            credit_note: `CN-${String(fixture.number)}-${String(index + 1)}`,
        });
        const legs = evidence.entries.filter(
            (entry) => entry.event === "refund" && entry.source_id === refund.id,
        );
        expect(legs).toHaveLength(4);
        expect(new Set(legs.map((entry) => entry.journal_id)).size).toBe(1);
        expect(legs.reduce((sum, entry) => sum + entry.amount_cents, 0)).toBe(0);
        expect(legs).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ category: "cash", amount_cents: -5600 }),
                expect.objectContaining({ category: "revenue", amount_cents: 5000 }),
                expect.objectContaining({ category: "tax", code: "GST", amount_cents: 250 }),
                expect.objectContaining({ category: "tax", code: "PST", amount_cents: 350 }),
            ]),
        );
    }
    for (const [category, total] of [
        ["cash", 11200 - count * 5600],
        ["revenue", -10000 + count * 5000],
        ["tax", -1200 + count * 600],
        ["receivable", 0],
    ] as const) {
        expect(
            evidence.entries
                .filter((entry) => entry.category === category)
                .reduce((sum, entry) => sum + entry.amount_cents, 0),
        ).toBe(total);
    }
}

export async function expectCreditNotes(page: Page, fixture: RefundFixture): Promise<void> {
    await page.goto("/payments/refunds");
    await page.getByRole("tab", { name: strings.refunds.tabs.notes, exact: true }).click();
    for (const number of [1, 2]) {
        const note = page.getByText(`CN-${String(fixture.number)}-${String(number)}`, {
            exact: true,
        });
        await expect(note).toBeVisible({ timeout: 60_000 });
    }
}
