import { useQuery } from "@powersync/react";

import type { ApiLike } from "../util/api";
import { blankToNull } from "../util/format";
import type { Intent } from "../util/intent";

export interface InvoiceRow {
    id: string;
    client_id: string;
    client_name: string | null;
    number: number | null;
    status: string;
    total_cents: number | null;
    balance_cents: number | null;
    issued_at: string | null;
    due_at: string | null;
    created_at: string;
}

export interface EstimateRow {
    id: string;
    client_id: string;
    client_name: string | null;
    number: number | null;
    status: string;
    total_cents: number | null;
    valid_until: string | null;
    converted_invoice_id: string | null;
    created_at: string;
}

export interface LineRow {
    id: string;
    description: string;
    quantity: number;
    unit_amount_cents: number;
    amount_cents: number;
    tax_amount_cents: number;
    position: number;
}

const INVOICES_SQL = `
SELECT i.id, i.client_id, c.name AS client_name, i.number, i.status,
       i.total_cents, i.balance_cents, i.issued_at, i.due_at, i.created_at
FROM invoices i
LEFT JOIN clients c ON c.id = i.client_id
ORDER BY i.created_at DESC`;

const ESTIMATES_SQL = `
SELECT e.id, e.client_id, c.name AS client_name, e.number, e.status,
       e.total_cents, e.valid_until, e.converted_invoice_id, e.created_at
FROM estimates e
LEFT JOIN clients c ON c.id = e.client_id
ORDER BY e.created_at DESC`;

const LINES_SQL = `
SELECT id, description, quantity, unit_amount_cents, amount_cents, tax_amount_cents, position
FROM lines WHERE parent_type = ? AND parent_id = ? ORDER BY position`;

export function useInvoices(): InvoiceRow[] {
    return useQuery<InvoiceRow>(INVOICES_SQL).data;
}

export function useEstimates(): EstimateRow[] {
    return useQuery<EstimateRow>(ESTIMATES_SQL).data;
}

export function useLines(parentType: "invoice" | "estimate", parentId: string): LineRow[] {
    return useQuery<LineRow>(LINES_SQL, [parentType, parentId]).data;
}

export function filterInvoices(rows: InvoiceRow[], q: string): InvoiceRow[] {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter(
        (r) =>
            (r.client_name ?? "").toLowerCase().includes(t) ||
            (r.number !== null && String(r.number).includes(t)) ||
            r.status.includes(t),
    );
}

export function filterEstimates(rows: EstimateRow[], q: string): EstimateRow[] {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter(
        (r) =>
            (r.client_name ?? "").toLowerCase().includes(t) ||
            (r.number !== null && String(r.number).includes(t)) ||
            r.status.includes(t),
    );
}

// The status → visual-intent decision is shared; each platform maps the intent to its own tokens.
export function invoiceStatusIntent(status: string): Intent {
    switch (status) {
        case "paid":
            return "success";
        case "sent":
            return "accent";
        case "partial":
            return "warning";
        case "overdue":
            return "danger";
        default:
            return "neutral"; // draft, void
    }
}

export function estimateStatusIntent(status: string): Intent {
    switch (status) {
        case "accepted":
            return "success";
        case "sent":
            return "accent";
        case "declined":
            return "danger";
        default:
            return "neutral"; // draft, expired
    }
}

export interface LineInput {
    description: string;
    quantity: number;
    unit_amount_cents: number;
}

export interface DocResult {
    id: string;
    status: string;
    number: number | null;
}

export function createInvoice(
    api: ApiLike,
    clientId: string,
    lines: LineInput[],
    notes?: string | null,
): Promise<DocResult> {
    return api.post<DocResult>("/v1/invoices", {
        client_id: clientId,
        lines,
        notes: blankToNull(notes),
    });
}

export function updateInvoice(
    api: ApiLike,
    id: string,
    patch: { lines?: LineInput[]; notes?: string | null },
): Promise<DocResult> {
    return api.patch<DocResult>(`/v1/invoices/${id}`, patch);
}

export function sendInvoice(api: ApiLike, id: string): Promise<DocResult> {
    return api.post<DocResult>(`/v1/invoices/${id}/send`, {});
}

export function voidInvoice(api: ApiLike, id: string): Promise<DocResult> {
    return api.post<DocResult>(`/v1/invoices/${id}/void`, {});
}

export function createEstimate(
    api: ApiLike,
    clientId: string,
    lines: LineInput[],
    notes?: string | null,
): Promise<DocResult> {
    return api.post<DocResult>("/v1/estimates", {
        client_id: clientId,
        lines,
        notes: blankToNull(notes),
    });
}

export function updateEstimate(
    api: ApiLike,
    id: string,
    patch: { lines?: LineInput[]; notes?: string | null },
): Promise<DocResult> {
    return api.patch<DocResult>(`/v1/estimates/${id}`, patch);
}

export function sendEstimate(api: ApiLike, id: string): Promise<DocResult> {
    return api.post<DocResult>(`/v1/estimates/${id}/send`, {});
}

export function acceptEstimate(api: ApiLike, id: string): Promise<DocResult> {
    return api.post<DocResult>(`/v1/estimates/${id}/accept`, {});
}

export function declineEstimate(api: ApiLike, id: string): Promise<DocResult> {
    return api.post<DocResult>(`/v1/estimates/${id}/decline`, {});
}

export function convertEstimate(api: ApiLike, id: string): Promise<DocResult> {
    return api.post<DocResult>(`/v1/estimates/${id}/convert`, {});
}

export type DocActionKey = "send" | "void" | "accept" | "decline" | "convert";

export interface DocAction {
    key: DocActionKey;
    run: () => Promise<DocResult>;
}

// The status → available-action state machine is shared; each platform maps the key to a label.
export function invoiceActions(api: ApiLike, row: InvoiceRow): DocAction[] {
    const out: DocAction[] = [];
    if (row.status === "draft") out.push({ key: "send", run: () => sendInvoice(api, row.id) });
    if (row.status !== "void" && row.status !== "paid")
        out.push({ key: "void", run: () => voidInvoice(api, row.id) });
    return out;
}

export function estimateActions(api: ApiLike, row: EstimateRow): DocAction[] {
    const out: DocAction[] = [];
    if (row.status === "draft") out.push({ key: "send", run: () => sendEstimate(api, row.id) });
    if (row.status === "sent") {
        out.push({ key: "accept", run: () => acceptEstimate(api, row.id) });
        out.push({ key: "decline", run: () => declineEstimate(api, row.id) });
    }
    if ((row.status === "sent" || row.status === "accepted") && row.converted_invoice_id === null)
        out.push({ key: "convert", run: () => convertEstimate(api, row.id) });
    return out;
}

export interface DraftLine {
    description: string;
    quantity: string;
    unit: string;
}

export function toLineInputs(drafts: DraftLine[]): LineInput[] {
    return drafts
        .filter((l) => l.description.trim().length > 0)
        .map((l) => ({
            description: l.description.trim(),
            quantity: Number(l.quantity) || 0,
            unit_amount_cents: Math.round((Number(l.unit) || 0) * 100),
        }));
}

export function lineSubtotalCents(lines: LineInput[]): number {
    return lines.reduce((s, l) => s + Math.round(l.quantity * l.unit_amount_cents), 0);
}
