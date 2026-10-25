import { randomUUID } from "node:crypto";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { strings } from "@clientbridge/app-core/public";
import { expect, type Page } from "@playwright/test";

import { requireLocalMail } from "./evidence";
import { navigate } from "./session";

export interface InvoiceFixture {
    id: string;
    email: string;
    name: string;
}

export async function createInvoice(page: Page): Promise<InvoiceFixture> {
    await requireLocalMail();
    const run = randomUUID();
    const name = demoPerson(run);
    const email = `e2e-${run}@example.ca`;
    const api = process.env.VITE_API_URL ?? "http://localhost:8701";
    if (!["localhost", "127.0.0.1"].includes(new URL(api).hostname)) {
        throw new Error("The billing pilot requires a local API and SMTP sink");
    }
    const clientResponse = await page.request.post(`${api}/v1/clients`, {
        data: { name, email, preferred_channel: "email" },
        headers: { "Idempotency-Key": randomUUID(), Origin: new URL(page.url()).origin },
    });
    expect(clientResponse.status(), await clientResponse.text()).toBe(201);
    const client = (await clientResponse.json()) as { id: string };
    const response = await page.request.post(`${api}/v1/invoices`, {
        data: {
            client_id: client.id,
            lines: [
                {
                    description: "Paw care consultation",
                    quantity: 1,
                    unit_amount_cents: 1000,
                    tax_class: "exempt",
                },
            ],
            notes: "Thank you for trusting Birch & Bark with your pet’s care.",
            send: true,
        },
        headers: { "Idempotency-Key": randomUUID(), Origin: new URL(page.url()).origin },
    });
    expect(response.status(), await response.text()).toBe(201);
    const invoice = (await response.json()) as {
        id: string;
        total_cents: number;
        balance_cents: number;
    };
    expect(invoice.total_cents).toBe(1000);
    expect(invoice.balance_cents).toBe(1000);
    return { id: invoice.id, email, name };
}

export async function openInvoice(page: Page, invoice: InvoiceFixture): Promise<void> {
    await navigate(page, `/payments/invoices?open=${invoice.id}`);
    await expect(
        page.getByRole("dialog").getByText(invoice.name, { exact: true }).first(),
    ).toBeVisible({ timeout: 60_000 });
}

export async function recordCash(page: Page, amount: string): Promise<void> {
    await page.getByRole("button", { name: strings.billing.recordPayment, exact: true }).click();
    await expect(
        page.getByRole("checkbox", { name: strings.billing.rec.sendReceipt }),
    ).toBeChecked();
    await page
        .getByRole("button", { name: strings.billing.rec.record(amount), exact: true })
        .click();
    await expect(page.getByText(strings.billing.rec.doneTitle, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: strings.common.done, exact: true }).click();
}

export async function expectPaid(page: Page): Promise<void> {
    const dialog = page.getByRole("dialog");
    await expect(
        dialog.getByText(strings.billing.statusLabel.paid, { exact: true }).first(),
    ).toBeVisible();
    await expect(
        dialog.getByRole("button", { name: strings.billing.recordPayment, exact: true }),
    ).toHaveCount(0);
}
