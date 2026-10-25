import { randomUUID } from "node:crypto";
import { strings } from "@clientbridge/app-core/public";
import { expect, type Page } from "@playwright/test";

import { createInvoice, openInvoice, type InvoiceFixture } from "./billing";
import { editClient, type ClientFixture } from "./crm";
import { paymentEvidence, type PaymentEvidence } from "./evidence";
import { documentEvidence, type DocumentEvidence } from "./invoices";

export interface SecurityFixture {
    invoice: InvoiceFixture;
    client: ClientFixture;
    paymentId: string;
    payments: PaymentEvidence;
    document: DocumentEvidence;
}

export async function prepareSecurityFixture(page: Page): Promise<SecurityFixture> {
    const invoice = await createInvoice(page);
    await openInvoice(page, invoice);
    await page.getByRole("button", { name: strings.billing.recordPayment, exact: true }).click();
    await page.getByRole("button", { name: strings.billing.rec.partial, exact: true }).click();
    await page.getByRole("textbox", { name: strings.billing.rec.amount, exact: true }).fill("4.00");
    const recording = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === `/v1/invoices/${invoice.id}/payments` &&
            response.request().method() === "POST",
    );
    await page
        .getByRole("button", { name: strings.billing.rec.record("$4.00"), exact: true })
        .click();
    const recorded = await recording;
    expect(recorded.status(), await recorded.text()).toBe(201);
    const body = (await recorded.json()) as { payment_id: string };
    await expect(page.getByText(strings.billing.rec.doneTitle, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: strings.common.done, exact: true }).click();
    const payments = await paymentEvidence(invoice.id);
    expect(payments.payments).toEqual([
        {
            id: body.payment_id,
            amount_cents: 400,
            status: "succeeded",
            method: "cash",
            provider: "manual",
        },
    ]);
    const document = await documentEvidence("invoice", invoice.id);
    return {
        invoice,
        client: { id: document.document.client_id, name: invoice.name, email: invoice.email },
        paymentId: body.payment_id,
        payments,
        document,
    };
}

export async function expectRefused(
    page: Page,
    path: string,
    method: "GET" | "POST" | "PATCH",
    status: 403 | 404,
    data?: Record<string, string | number | boolean>,
    businessId?: string,
): Promise<void> {
    const api = process.env.VITE_API_URL ?? "http://localhost:8701";
    const response = await page.request.fetch(`${api}/v1/${path}`, {
        method,
        data,
        headers: {
            Origin: new URL(page.url()).origin,
            "Idempotency-Key": randomUUID(),
            ...(businessId === undefined ? {} : { "X-Business-Id": businessId }),
        },
    });
    expect(response.status(), `${method} ${path}: ${await response.text()}`).toBe(status);
    expect(await response.json()).toMatchObject({
        error: status === 403 ? "forbidden" : "not_found",
    });
}

export async function expectOwnerUnchanged(page: Page, fixture: SecurityFixture): Promise<void> {
    expect(await paymentEvidence(fixture.invoice.id)).toEqual(fixture.payments);
    expect(await documentEvidence("invoice", fixture.invoice.id)).toEqual(fixture.document);
    await page.reload();
    await openInvoice(page, fixture.invoice);
    const dialog = page.getByRole("dialog");
    await expect(
        dialog.getByText(strings.billing.statusLabel.partial, { exact: true }).first(),
    ).toBeVisible();
    await dialog.getByRole("button", { name: strings.billing.recordPayment, exact: true }).click();
    await expect(
        page.getByRole("button", { name: strings.billing.rec.record("$6.00"), exact: true }),
    ).toBeVisible();
    const paymentDialog = page.getByRole("dialog").last();
    await expect(
        paymentDialog.getByRole("heading", { name: strings.billing.rec.title, exact: true }),
    ).toBeVisible();
    await paymentDialog.getByRole("button", { name: strings.common.close, exact: true }).click();
    await page
        .getByRole("dialog")
        .getByRole("button", { name: strings.common.close, exact: true })
        .click();
    const client = await editClient(page, fixture.client);
    await expect(
        client.getByRole("button", { name: strings.clients.edit.archive, exact: true }),
    ).toBeVisible();
    await client.getByRole("button", { name: strings.common.cancel, exact: true }).click();
}
