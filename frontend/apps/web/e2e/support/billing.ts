import { randomUUID } from "node:crypto";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { strings, formatMoney } from "@clientbridge/app-core/public";
import { expect, type Page, type Locator } from "@playwright/test";
import { requireLocalMail } from "./evidence";
import { navigate } from "./session";
import { runUrl } from "@clientbridge/config/e2e/run";
import { freshPhone, type Text, textsTo } from "./auth";
import { select } from "./db";

/** Picks which records a Payments list shows, from its Show dropdown. */
export async function showOnly(page: Page, option: RegExp): Promise<void> {
    const show = strings.ui.listShow;
    await page.getByRole("main").getByRole("combobox", { name: show, exact: true }).click();
    await page.getByRole("listbox", { name: show }).getByRole("option", { name: option }).click();
}

export interface InvoiceFixture {
    id: string;
    phone: string;
    name: string;
}

export async function createInvoice(page: Page): Promise<InvoiceFixture> {
    requireLocalMail();
    const run = randomUUID();
    const name = demoPerson(run);
    const phone = freshPhone();
    const api = runUrl("VITE_API_URL");
    if (!["localhost", "127.0.0.1"].includes(new URL(api).hostname)) {
        throw new Error("The billing pilot requires a local API and SMTP sink");
    }
    const clientResponse = await page.request.post(`${api}/v1/clients`, {
        data: { name, phone },
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
    return { id: invoice.id, phone, name };
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

/** Records a manual payment in the invoice's drawer, for part of the balance when given. */
export async function recordPayment(
    page: Page,
    method: "cash" | "etransfer",
    label: string,
    part?: string,
): Promise<string> {
    const r = strings.billing.rec;
    await page.getByRole("button", { name: strings.billing.recordPayment, exact: true }).click();
    const dialog = page.getByRole("region", { name: r.title, exact: true });
    await dialog
        .getByRole("group", { name: r.howPaid, exact: true })
        .getByRole("button")
        .filter({ hasText: method === "cash" ? r.cash : r.etransfer })
        .click();
    if (part !== undefined) {
        await dialog
            .getByRole("group", { name: r.amount, exact: true })
            .getByRole("button", { name: r.partial, exact: true })
            .click();
        await dialog.getByRole("textbox", { name: r.amount, exact: true }).fill(part);
    }
    await dialog.getByRole("button", { name: r.record(label), exact: true }).click();
    await expect(dialog.getByText(r.doneTitle, { exact: true })).toBeVisible();
    const summary = await dialog.innerText();
    await dialog.getByRole("button", { name: strings.common.done, exact: true }).click();
    return summary;
}

export interface DocumentClient {
    id: string;
    name: string;
    phone: string;
}

export interface DocumentRecord {
    id: string;
    client_id: string;
    status: string;
    subtotal_cents: number;
    tax_total_cents: number;
    total_cents: number;
    number: number | null;
    notes: string | null;
    converted_invoice_id?: string | null;
}

interface DocumentLine {
    description: string;
    quantity: number;
    unit_amount_cents: number;
    amount_cents: number;
    tax_amount_cents: number;
    discount_cents: number;
    sale_discount_cents: number;
    tax_class: string;
    optional: boolean;
    selected: boolean;
    booking_id: string | null;
    staff_id: string | null;
}

export interface DocumentEvidence {
    document: DocumentRecord;
    lines: DocumentLine[];
    siblings: { id: string; status: string }[];
    bookings: { id: string; status: string; deposit_status: string; invoice_id: string | null }[];
}

function invoiceEvidence(id: string) {
    return Promise.all([
        select<{ data: DocumentRecord }>`
            SELECT to_jsonb(d) - 'pay_token' - 'view_token' AS data FROM invoices d
            WHERE id = ${id}`,
        select<{ data: DocumentLine }>`
            SELECT to_jsonb(l) AS data FROM lines l WHERE invoice_id = ${id} ORDER BY position`,
        select<DocumentEvidence["siblings"][number]>`
            SELECT id, status FROM invoices
            WHERE client_id = (SELECT client_id FROM invoices WHERE id = ${id}) ORDER BY id`,
        select<DocumentEvidence["bookings"][number]>`
            SELECT id, status, deposit_status, invoice_id FROM bookings
            WHERE id IN (SELECT booking_id FROM lines WHERE invoice_id = ${id})
                OR invoice_id = ${id}
            ORDER BY id`,
    ]);
}

function estimateEvidence(id: string) {
    return Promise.all([
        select<{ data: DocumentRecord }>`
            SELECT to_jsonb(d) - 'pay_token' - 'view_token' AS data FROM estimates d
            WHERE id = ${id}`,
        select<{ data: DocumentLine }>`
            SELECT to_jsonb(l) AS data FROM lines l WHERE estimate_id = ${id} ORDER BY position`,
        select<DocumentEvidence["siblings"][number]>`
            SELECT id, status FROM estimates
            WHERE client_id = (SELECT client_id FROM estimates WHERE id = ${id}) ORDER BY id`,
        select<DocumentEvidence["bookings"][number]>`
            SELECT id, status, deposit_status, invoice_id FROM bookings
            WHERE id IN (SELECT booking_id FROM lines WHERE estimate_id = ${id}) ORDER BY id`,
    ]);
}

export async function documentEvidence(
    kind: "invoice" | "estimate",
    id: string,
): Promise<DocumentEvidence> {
    const [documents, lines, siblings, bookings] = await (kind === "invoice"
        ? invoiceEvidence(id)
        : estimateEvidence(id));
    const [document] = documents;
    if (documents.length !== 1 || document === undefined)
        throw new Error(`expected exactly one ${kind} ${id}`);
    return { document: document.data, lines: lines.map((row) => row.data), siblings, bookings };
}

export async function createDocumentClient(page: Page): Promise<DocumentClient> {
    requireLocalMail();
    const api = runUrl("VITE_API_URL");
    if (!["localhost", "127.0.0.1"].includes(new URL(api).hostname)) {
        throw new Error("Document fixtures require a local API and SMTP sink");
    }
    const run = randomUUID();
    const name = demoPerson(run);
    const phone = freshPhone();
    const response = await page.request.post(`${api}/v1/clients`, {
        headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
        data: { name, phone },
    });
    expect(response.status(), await response.text()).toBe(201);
    return { id: ((await response.json()) as { id: string }).id, name, phone };
}

export async function composeDocument(
    page: Page,
    client: DocumentClient,
    kind: "invoice" | "estimate",
): Promise<Locator> {
    await navigate(page, `/payments/invoices?new=1${kind === "estimate" ? "&doc=estimates" : ""}`);
    const editor = page.getByRole("dialog").filter({
        has: page.getByRole("button", { name: strings.billing.saveDraft, exact: true }),
    });
    await editor
        .getByRole("combobox", { name: strings.billing.client, exact: true })
        .fill(client.name);
    await page
        .getByRole("option")
        .filter({ has: page.getByText(client.name, { exact: true }) })
        .click();
    return editor;
}

export async function fillDocumentLine(
    page: Page,
    editor: Locator,
    index: number,
    description: string,
    quantity: string,
    price: string,
    tax: "standard" | "federal_only" | "exempt",
): Promise<void> {
    const descriptions = editor.getByRole("textbox", {
        name: strings.billing.description,
        exact: true,
    });
    // A new document starts with no lines, so the first custom line is added here.
    if ((await descriptions.count()) <= index)
        await editor
            .getByRole("button", { name: strings.billing.addCustomLine, exact: true })
            .click();
    await descriptions.nth(index).fill(description);
    await editor
        .getByRole("textbox", { name: strings.billing.qty, exact: true })
        .nth(index)
        .fill(quantity);
    await editor
        .getByRole("textbox", { name: strings.billing.price, exact: true })
        .nth(index)
        .fill(price);
    if (tax === "standard") return;
    await editor
        .getByRole("combobox", { name: strings.billing.taxClass, exact: true })
        .nth(index)
        .click();
    const label = tax === "exempt" ? strings.catalog.taxExempt : strings.catalog.taxOnly("GST");
    await page.getByRole("option", { name: label, exact: true }).click();
}

export async function applyPercentDiscount(scope: Locator, percent: string): Promise<void> {
    await scope
        .getByRole("textbox", { name: strings.pos.desk.percentOff, exact: true })
        .fill(percent);
    await scope
        .getByRole("textbox", { name: strings.pos.desk.otherReason, exact: true })
        .fill("Returning client courtesy");
    await scope.getByRole("button", { name: strings.pos.desk.applyDiscount, exact: true }).click();
}

export async function saveDocument(
    page: Page,
    editor: Locator,
    kind: "invoice" | "estimate",
    id?: string,
): Promise<DocumentRecord> {
    const response = page.waitForResponse(
        (result) =>
            result.url().endsWith(`/v1/${kind}s${id === undefined ? "" : `/${id}`}`) &&
            result.request().method() === (id === undefined ? "POST" : "PATCH"),
    );
    await editor.getByRole("button", { name: strings.billing.saveDraft, exact: true }).click();
    const result = await response;
    expect(result.status(), await result.text()).toBe(id === undefined ? 201 : 200);
    await expect(editor.getByText(strings.billing.draftSaved, { exact: true })).toBeVisible();
    return (await result.json()) as DocumentRecord;
}

export async function openDocument(
    page: Page,
    client: DocumentClient,
    kind: "invoice" | "estimate",
    id: string,
): Promise<Locator> {
    await navigate(
        page,
        `/payments/invoices?open=${id}${kind === "estimate" ? "&doc=estimates" : ""}`,
    );
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(client.name, { exact: true }).first()).toBeVisible({
        timeout: 60_000,
    });
    return dialog;
}

export async function expectDocumentTotal(dialog: Locator, cents: number): Promise<void> {
    await expect(
        dialog.getByText(formatMoney(cents, "CAD"), { exact: true }).first(),
    ).toBeVisible();
}

export async function documentTexts(page: Page, client: DocumentClient): Promise<Text[]> {
    return textsTo(page.request, client.phone);
}
