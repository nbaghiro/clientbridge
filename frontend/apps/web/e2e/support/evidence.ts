import type { APIRequestContext } from "@playwright/test";
import { runSetting } from "@clientbridge/config/e2e/run";
import { type Text, textsTo } from "./auth";
import { select } from "./db";

export interface PaymentEvidence {
    deliveries: { id: string; state: string }[];
    payments: {
        id: string;
        amount_cents: number;
        status: string;
        method: string;
        provider: string;
    }[];
    entries: {
        journal_id: string;
        event: string;
        amount_cents: number;
        category: string;
        source_id: string;
    }[];
}

export async function paymentEvidence(invoiceId: string): Promise<PaymentEvidence> {
    return {
        payments: await select<PaymentEvidence["payments"][number]>`
            SELECT id, amount_cents, status, method, provider FROM payments
            WHERE invoice_id = ${invoiceId} ORDER BY id`,
        entries: await select<PaymentEvidence["entries"][number]>`
            SELECT e.journal_id, e.event, e.amount_cents, a.category, e.source_id
            FROM entries e JOIN accounts a ON a.id = e.account_id
            WHERE e.subject_type = 'invoice' AND e.subject_id = ${invoiceId}
            ORDER BY e.journal_id, e.leg`,
        deliveries: await select<PaymentEvidence["deliveries"][number]>`
            SELECT d.id, d.state FROM deliveries d
            JOIN payments p ON d.key LIKE 'payment:' || p.id || ':%'
            WHERE p.invoice_id = ${invoiceId} AND d.payload->>'channel' = 'sms'
            ORDER BY d.id`,
    };
}

/** The payment receipts texted to `phone`; the invoice itself is texted to the same number. */
export async function receiptMessages(request: APIRequestContext, phone: string): Promise<Text[]> {
    return (await textsTo(request, phone)).filter((text) => text.Snippet.includes("was received"));
}

/** Refuses to run unless the stack is a dev stack whose mail lands in a local sink. */
export function requireLocalMail(): void {
    const smtp = new URL(runSetting("SMTP_URL")).hostname;
    if (runSetting("ENV") !== "dev" || !["localhost", "127.0.0.1", "mailpit"].includes(smtp))
        throw new Error("e2e requires dev settings and a local SMTP sink");
}
