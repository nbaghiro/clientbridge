import { randomUUID } from "node:crypto";
import { formatMoney, strings } from "@clientbridge/app-core/public";
import { demoPerson } from "@clientbridge/config/e2e/demo";
import { expect, type Locator, type Page } from "@playwright/test";

import { select } from "./db";
import { requireLocalMail } from "./evidence";
import { navigate } from "./session";
import { runEmail, runUrl } from "@clientbridge/config/e2e/run";

export interface DocumentClient {
    id: string;
    name: string;
    email: string;
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
    const email = runEmail(`document-${run}@example.ca`);
    const response = await page.request.post(`${api}/v1/clients`, {
        headers: { Origin: new URL(page.url()).origin, "Idempotency-Key": randomUUID() },
        data: { name, email, preferred_channel: "email" },
    });
    expect(response.status(), await response.text()).toBe(201);
    return { id: ((await response.json()) as { id: string }).id, name, email };
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
        .fill(client.email);
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
    await editor
        .getByRole("textbox", { name: strings.billing.description, exact: true })
        .nth(index)
        .fill(description);
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

export async function documentMail(
    page: Page,
    client: DocumentClient,
): Promise<{ ID: string; Subject: string; Snippet: string }[]> {
    const base = runUrl("MAILPIT_URL");
    const response = await page.request.get(`${base}/api/v1/search`, {
        params: { query: `to:${client.email}`, limit: 100 },
    });
    expect(response.status()).toBe(200);
    return (
        (await response.json()) as { messages: { ID: string; Subject: string; Snippet: string }[] }
    ).messages;
}
