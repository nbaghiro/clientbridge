import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { strings } from "@clientbridge/app-core/public";
import { expect, type Page } from "@playwright/test";

import {
    composeDocument,
    createDocumentClient,
    documentEvidence,
    documentMail,
    fillDocumentLine,
    openDocument,
    saveDocument,
    type DocumentClient,
} from "../../web/e2e/support/invoices";
import { paymentEvidence, receiptMessages } from "../../web/e2e/support/evidence";
import { on } from "./hosts";
import { registerStripeInvoice, stripeReady } from "./stripe-provider";

const execute = promisify(execFile);

export async function issueStripeInvoice(page: Page) {
    await stripeReady();
    const client = await createDocumentClient(page);
    const editor = await composeDocument(page, client, "invoice");
    await fillDocumentLine(page, editor, 0, "Grooming consultation", "1", "20.00", "exempt");
    const draft = await saveDocument(page, editor, "invoice");
    expect(draft).toMatchObject({ status: "draft", total_cents: 2000, tax_total_cents: 0 });
    expect((await paymentEvidence(draft.id)).entries).toEqual([]);
    await openDocument(page, client, "invoice", draft.id);
    await page.getByRole("button", { name: strings.billing.sendInvoice, exact: true }).click();
    const review = page.getByRole("dialog").filter({
        has: page.getByRole("heading", { name: strings.previews.title, exact: true }),
    });
    await expect(review.getByText(client.email, { exact: false }).first()).toBeVisible();
    const sent = page.waitForResponse(
        (response) =>
            response.url().endsWith(`/invoices/${draft.id}/send`) &&
            response.request().method() === "POST",
    );
    await review.getByRole("button", { name: strings.billing.sendInvoice, exact: true }).click();
    const response = await sent;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
        status: "sent",
        total_cents: 2000,
        balance_cents: 2000,
    });
    expect((await documentEvidence("invoice", draft.id)).document).toMatchObject({
        status: "sent",
        total_cents: 2000,
        tax_total_cents: 0,
    });
    const issued = await paymentEvidence(draft.id);
    expect(issued.payments).toEqual([]);
    expect(
        issued.entries
            .map((entry) => ({ category: entry.category, amount: entry.amount_cents }))
            .sort((a, b) => a.category.localeCompare(b.category)),
    ).toEqual([
        { category: "receivable", amount: 2000 },
        { category: "revenue", amount: -2000 },
    ]);
    expect(new Set(issued.entries.map((entry) => entry.journal_id)).size).toBe(1);
    await expect.poll(async () => (await documentMail(page, client)).length).toBe(1);
    const message = (await documentMail(page, client))[0];
    if (!message) throw new Error("Invoice email is absent");
    const detail = await page.request.get(
        `${process.env.MAILPIT_URL}/api/v1/message/${message.ID}`,
    );
    expect(detail.status()).toBe(200);
    const mail = (await detail.json()) as { Text: string; To: { Address: string }[] };
    expect(mail.To.map((recipient) => recipient.Address)).toEqual([client.email]);
    const links = mail.Text.match(/https?:\/\/[^\s<>"']+/g) ?? [];
    const payLinks = links.filter((link) => new URL(link).pathname.startsWith("/i/"));
    expect(payLinks).toHaveLength(1);
    const url = payLinks[0];
    if (!url) throw new Error("Invoice email has no payment link");
    const parsed = new URL(url);
    expect(parsed.origin).toBe(new URL(on("pay", "")).origin);
    expect(parsed.pathname).toMatch(/^\/i\/[^/]+$/);
    const token = parsed.pathname.slice(3);
    const invoice = await registerStripeInvoice(page.request, { id: draft.id, pay_token: token });
    return { invoice, client, url, invoiceMailId: message.ID };
}

export async function stripeReceiptEvidence(
    invoiceId: string,
): Promise<{ receipts: { id: string; key: string; state: string; payment_id: string }[] }> {
    const { stdout } = await execute(
        "uv",
        ["run", "python", "-m", "e2e.stripe", "browser", invoiceId, "--receipts"],
        {
            cwd: fileURLToPath(new URL("../../../../backend", import.meta.url)),
            timeout: 60_000,
        },
    );
    return JSON.parse(stdout) as {
        receipts: { id: string; key: string; state: string; payment_id: string }[];
    };
}

export async function stripeReceipt(
    page: Page,
    client: DocumentClient,
    invoiceId: string,
    paymentId: string,
) {
    let evidence: { receipts: { id: string; key: string; state: string; payment_id: string }[] } = {
        receipts: [],
    };
    await expect(async () => {
        evidence = await stripeReceiptEvidence(invoiceId);
        expect(evidence.receipts).toEqual([
            {
                id: expect.any(String),
                key: expect.stringContaining(`stripe:payment:${paymentId}:`),
                state: "accepted",
                payment_id: paymentId,
            },
        ]);
        expect(await receiptMessages(page.request, client.email)).toHaveLength(1);
    }).toPass({ timeout: 60_000 });
    const message = (await receiptMessages(page.request, client.email))[0];
    if (!message) throw new Error("Payment receipt is absent");
    expect(message.Snippet).toContain("$20.00");
    return { ...evidence, mailId: message.ID };
}

export async function controlStripeRelay(
    page: Page,
    action: "arm" | "status" | "release",
    data: { invoice: string; intent: string } | Record<string, never> = {},
) {
    const url = process.env.STRIPE_BROWSER_RELAY_URL;
    const token = process.env.STRIPE_BROWSER_RELAY_TOKEN;
    if (!url || !token || new URL(url).hostname !== "127.0.0.1")
        throw new Error("Owned local Stripe relay is missing");
    const response = await page.request.post(`${url}/${action}`, {
        headers: { Authorization: `Bearer ${token}` },
        data,
    });
    expect(response.status()).toBe(200);
    return (await response.json()) as {
        held?: boolean;
        upstream_status?: number;
        records?: { status: string; event?: string }[];
    };
}
