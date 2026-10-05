import { useQuery } from "@powersync/react";
import { useState } from "react";

import { useAsyncAction } from "../hooks";
import type { ApiLike } from "../api";
import { blankToNull } from "../format";
import type { Intent } from "../ui";
import { strings } from "../strings";
import { invoiceStatusSql, subjectNetSql } from "./ledger";

export interface InvoiceRow {
    id: string;
    client_id: string;
    client_name: string | null;
    number: number | null;
    status: string;
    subtotal_cents: number | null;
    tax_total_cents: number | null;
    total_cents: number | null;
    balance_cents: number | null;
    issued_at: string | null;
    due_at: string | null;
    pay_token: string | null;
    notes: string | null;
    created_at: string;
}

export interface EstimateRow {
    id: string;
    client_id: string;
    client_name: string | null;
    number: number | null;
    status: string;
    subtotal_cents: number | null;
    tax_total_cents: number | null;
    total_cents: number | null;
    valid_until: string | null;
    converted_invoice_id: string | null;
    notes: string | null;
    created_at: string;
}

export interface LineRow {
    id: string;
    item_id: string | null;
    description: string;
    quantity: number;
    unit_amount_cents: number;
    amount_cents: number;
    tax_amount_cents: number;
    position: number;
}

export const INVOICES_SQL = `
SELECT i.id, i.client_id, c.name AS client_name, i.number, ${invoiceStatusSql("i")} AS status,
       i.subtotal_cents,
       i.tax_total_cents, i.total_cents,
       CASE WHEN i.status = 'draft' THEN i.total_cents
            ELSE COALESCE(${subjectNetSql("receivable", "invoice", "i.id")}, 0) END AS balance_cents,
       i.issued_at, i.due_at, i.pay_token, i.notes, i.created_at
FROM invoices i
LEFT JOIN clients c ON c.id = i.client_id
ORDER BY COALESCE(i.issued_at, i.created_at) DESC, i.number DESC`;

export const ESTIMATES_SQL = `
SELECT e.id, e.client_id, c.name AS client_name, e.number,
       CASE WHEN e.status = 'sent' AND e.valid_until < date('now') THEN 'expired'
            ELSE e.status END AS status,
       e.subtotal_cents,
       e.tax_total_cents, e.total_cents, e.valid_until, e.converted_invoice_id, e.notes, e.created_at
FROM estimates e
LEFT JOIN clients c ON c.id = e.client_id
ORDER BY e.created_at DESC`;

export const LINES_SQL = `
SELECT id, item_id, description, quantity, unit_amount_cents, amount_cents, tax_amount_cents,
       position
FROM lines WHERE ? IN (invoice_id, estimate_id) ORDER BY position`;

export function useInvoices(): InvoiceRow[] {
    return useQuery<InvoiceRow>(INVOICES_SQL).data;
}

export function useEstimates(): EstimateRow[] {
    return useQuery<EstimateRow>(ESTIMATES_SQL).data;
}

export function useLines(parentId: string): LineRow[] {
    return useQuery<LineRow>(LINES_SQL, [parentId]).data;
}

export interface DocTotalRow {
    key: string;
    label: string;
    cents: number;
    strong: boolean;
}

interface TaxByCode {
    code: string;
    cents: number;
}

// Per-code tax is on an issued invoice's journal; without it the stored tax total is shown.
export const TAX_BY_CODE_SQL = `
SELECT a.code AS code, -SUM(e.amount_cents) AS cents
FROM entries e JOIN accounts a ON a.id = e.account_id
WHERE a.category = 'tax' AND e.ref = ?
GROUP BY a.code ORDER BY a.code`;

type DocAmounts = Pick<InvoiceRow, "subtotal_cents" | "tax_total_cents" | "total_cents">;

export function docTotals(doc: DocAmounts, byCode: TaxByCode[]): DocTotalRow[] {
    const tax = doc.tax_total_cents ?? 0;
    const split = byCode.filter((t) => t.cents !== 0);
    const taxRows =
        split.length > 0 && split.reduce((sum, t) => sum + t.cents, 0) === tax
            ? split.map((t) => ({ key: t.code, label: t.code, cents: t.cents, strong: false }))
            : tax !== 0
              ? [{ key: "tax", label: strings.invoices.tax, cents: tax, strong: false }]
              : [];
    return [
        {
            key: "subtotal",
            label: strings.invoices.subtotal,
            cents: doc.subtotal_cents ?? 0,
            strong: false,
        },
        ...taxRows,
        { key: "total", label: strings.invoices.total, cents: doc.total_cents ?? 0, strong: true },
    ];
}

/** Subtotal, each tax and the total for an invoice or estimate's detail view. */
export function useDocTotals(
    parentType: "invoice" | "estimate",
    doc: (DocAmounts & { id: string }) | null,
): DocTotalRow[] {
    const ref = parentType === "invoice" && doc !== null ? `invoice:${doc.id}` : "";
    const byCode = useQuery<TaxByCode>(TAX_BY_CODE_SQL, [ref]).data;
    return doc === null ? [] : docTotals(doc, byCode);
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
    item_id?: string | null;
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

export type DocTab = "invoices" | "estimates";

export const DOC_TABS: { key: DocTab; label: string }[] = [
    { key: "invoices", label: strings.invoices.tabInvoices },
    { key: "estimates", label: strings.invoices.tabEstimates },
];

export function docHeading(kind: DocTab, number: number | null): string {
    const noun =
        kind === "invoices" ? strings.invoices.invoiceHeading : strings.invoices.estimateHeading;
    return `${noun} ${number !== null ? `#${String(number)}` : strings.invoices.draftHeading}`;
}

/** Button copy for each document action — shared so web + mobile can't drift (they had). */
export const DOC_ACTION_LABEL: Record<DocActionKey, string> = {
    send: strings.invoices.actionSend,
    void: strings.invoices.actionVoid,
    accept: strings.invoices.actionAccept,
    decline: strings.invoices.actionDecline,
    convert: strings.invoices.actionConvert,
};

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
    itemId: string | null;
}

export function toLineInputs(drafts: DraftLine[]): LineInput[] {
    return drafts
        .filter((l) => l.description.trim().length > 0)
        .map((l) => ({
            description: l.description.trim(),
            quantity: Number(l.quantity) || 0,
            unit_amount_cents: Math.round((Number(l.unit) || 0) * 100),
            item_id: l.itemId,
        }));
}

/** An existing draft opened for editing: its client stays fixed, its lines and notes are editable. */
export interface DocDraft {
    id: string;
    clientId: string;
    notes: string;
    lines: DraftLine[];
}

export function docDraft(row: InvoiceRow | EstimateRow, lines: LineRow[]): DocDraft {
    return {
        id: row.id,
        clientId: row.client_id,
        notes: row.notes ?? "",
        lines: lines.map((l) => ({
            description: l.description,
            quantity: String(l.quantity),
            unit: (l.unit_amount_cents / 100).toFixed(2),
            itemId: l.item_id,
        })),
    };
}

export function lineSubtotalCents(lines: LineInput[]): number {
    return lines.reduce((s, l) => s + Math.round(l.quantity * l.unit_amount_cents), 0);
}

export function docEditorTitle(kind: "invoice" | "estimate", editing: boolean): string {
    return editing ? strings.invoices.editTitle(kind) : strings.invoices.newButton(kind);
}

export interface KeyedLine extends DraftLine {
    key: string;
}

let lineSeq = 0;
const keyed = (line: DraftLine): KeyedLine => ({ ...line, key: `l${(lineSeq += 1)}` });
const blankLine = (): KeyedLine =>
    keyed({ description: "", quantity: "1", unit: "", itemId: null });

export interface DocForm {
    clientId: string;
    setClientId: (v: string) => void;
    lines: KeyedLine[];
    setLine: (key: string, patch: Partial<DraftLine>) => void;
    addLine: () => void;
    removeLine: (key: string) => void;
    addCatalogItem: (item: { id: string; name: string; price_cents: number | null }) => void;
    editing: boolean;
    notes: string;
    setNotes: (v: string) => void;
    subtotalCents: number;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

export function useDocForm(
    api: ApiLike,
    kind: "invoice" | "estimate",
    onDone: () => void,
    draft?: DocDraft,
): DocForm {
    const [clientId, setClientId] = useState(draft?.clientId ?? "");
    const [lines, setLines] = useState<KeyedLine[]>(() =>
        draft !== undefined && draft.lines.length > 0 ? draft.lines.map(keyed) : [blankLine()],
    );
    const [notes, setNotes] = useState(draft?.notes ?? "");
    const { busy, error, setError, run } = useAsyncAction();

    const setLine = (key: string, patch: Partial<DraftLine>): void => {
        setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    };
    const addLine = (): void => {
        setLines((ls) => [...ls, blankLine()]);
    };
    const removeLine = (key: string): void => {
        setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));
    };

    const addCatalogItem = (item: { id: string; name: string; price_cents: number | null }) => {
        const line = keyed({
            description: item.name,
            quantity: "1",
            unit: ((item.price_cents ?? 0) / 100).toFixed(2),
            itemId: item.id,
        });
        setLines((ls) => {
            const last = ls.at(-1);
            const reuse = last?.description.trim() === "" && last.unit === "";
            return reuse ? [...ls.slice(0, -1), line] : [...ls, line];
        });
    };

    const subtotalCents = lineSubtotalCents(toLineInputs(lines));

    const submit = (): void => {
        const payload = toLineInputs(lines);
        if (clientId.length === 0 || payload.length === 0) {
            setError(strings.invoices.incompleteInvoice);
            return;
        }
        const patch = { lines: payload, notes: blankToNull(notes) };
        run(
            () =>
                draft !== undefined
                    ? kind === "invoice"
                        ? updateInvoice(api, draft.id, patch)
                        : updateEstimate(api, draft.id, patch)
                    : kind === "invoice"
                      ? createInvoice(api, clientId, payload, notes)
                      : createEstimate(api, clientId, payload, notes),
            { onSuccess: onDone, errorMessage: strings.invoices.saveError },
        );
    };

    return {
        clientId,
        setClientId,
        lines,
        setLine,
        addLine,
        removeLine,
        addCatalogItem,
        editing: draft !== undefined,
        notes,
        setNotes,
        subtotalCents,
        busy,
        error,
        submit,
    };
}
