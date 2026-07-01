import { useQuery } from "@powersync/react";
import { useEffect, useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import type { ApiLike } from "../util/api";
import { blankToNull } from "../util/format";
import type { Intent } from "../util/primitives";
import { strings } from "../strings";

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
    pay_token: string | null;
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
       i.total_cents, i.balance_cents, i.issued_at, i.due_at, i.pay_token, i.created_at
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

export type DocTab = "invoices" | "estimates";

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

export interface TaxRate {
    id: string;
    jurisdiction: string;
    province: string;
    rate_bps: number;
    name: string;
}

/** Province tax rates (REST today; the abstraction is the single place to move to sync later). */
export function useTaxRates(api: ApiLike): TaxRate[] | null {
    const [rates, setRates] = useState<TaxRate[] | null>(null);
    useEffect(() => {
        void api
            .get<TaxRate[]>("/v1/tax-rates")
            .then(setRates)
            .catch(() => {
                setRates([]);
            });
    }, [api]);
    return rates;
}

export interface KeyedLine extends DraftLine {
    key: string;
}

let lineSeq = 0;
const blankLine = (): KeyedLine => ({
    key: `l${(lineSeq += 1)}`,
    description: "",
    quantity: "1",
    unit: "",
});

export interface DocForm {
    clientId: string;
    setClientId: (v: string) => void;
    lines: KeyedLine[];
    setLine: (key: string, patch: Partial<DraftLine>) => void;
    addLine: () => void;
    removeLine: (key: string) => void;
    notes: string;
    setNotes: (v: string) => void;
    subtotalCents: number;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** Shared invoice/estimate builder: client + keyed draft lines + notes + validation + submit.
 *  The platform owns only the row/select widgets. */
export function useDocForm(
    api: ApiLike,
    kind: "invoice" | "estimate",
    onCreated: () => void,
): DocForm {
    const [clientId, setClientId] = useState("");
    const [lines, setLines] = useState<KeyedLine[]>([blankLine()]);
    const [notes, setNotes] = useState("");
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

    const subtotalCents = lineSubtotalCents(toLineInputs(lines));

    const submit = (): void => {
        const payload = toLineInputs(lines);
        if (clientId.length === 0 || payload.length === 0) {
            setError(strings.invoices.incompleteInvoice);
            return;
        }
        void run(
            () =>
                kind === "invoice"
                    ? createInvoice(api, clientId, payload, notes)
                    : createEstimate(api, clientId, payload, notes),
            { onSuccess: onCreated, errorMessage: strings.invoices.saveError },
        );
    };

    return {
        clientId,
        setClientId,
        lines,
        setLine,
        addLine,
        removeLine,
        notes,
        setNotes,
        subtotalCents,
        busy,
        error,
        submit,
    };
}
