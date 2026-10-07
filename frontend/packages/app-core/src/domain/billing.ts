import { useQuery } from "@powersync/react";
import { useMemo, useRef, useState } from "react";

import { type ApiLike, newIdempotencyKey } from "../api";
import { addDays, daysUntil, stampLabel } from "../datetime";
import { blankToNull, formatMoney, formatPhone, parseCents } from "../format";
import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type {
    DocTotalLine,
    Intent,
    PrintedDoc,
    PrintedDocLine,
    PrintedDocTax,
    TimelineEntry,
} from "../ui";
import { invoiceStatusSql, subjectNetSql } from "./ledger";
import { taxOptions } from "./catalog";
import { type PaymentRow, payLinkUrl, useInvoicePayments } from "./payments";
import { type Letterhead, longDate, printedDoc, ratePct, shortDate } from "./printing";
import { useReplicaLoad } from "./sync";
import { type TaxRate, useTaxSetup } from "./taxes";
import type { Load } from "../hooks";

const s = strings.billing;
const p = strings.printing;

export interface InvoiceRow {
    id: string;
    client_id: string;
    client_name: string | null;
    client_email: string | null;
    client_phone: string | null;
    number: number | null;
    status: string;
    subtotal_cents: number | null;
    tax_total_cents: number | null;
    total_cents: number | null;
    balance_cents: number | null;
    paid_cents: number | null;
    issued_at: string | null;
    due_at: string | null;
    paid_at: string | null;
    voided_at: string | null;
    pay_token: string | null;
    notes: string | null;
    created_at: string;
}

interface EstimateRow {
    id: string;
    client_id: string;
    client_name: string | null;
    client_email: string | null;
    client_phone: string | null;
    number: number | null;
    status: string;
    subtotal_cents: number | null;
    tax_total_cents: number | null;
    total_cents: number | null;
    valid_until: string | null;
    accepted_at: string | null;
    declined_at: string | null;
    decline_reason: string | null;
    view_token: string | null;
    converted_invoice_id: string | null;
    converted_number: number | null;
    notes: string | null;
    created_at: string;
}

interface LineRow {
    id: string;
    item_id: string | null;
    booking_id: string | null;
    description: string;
    quantity: number;
    unit_amount_cents: number;
    amount_cents: number;
    tax_amount_cents: number;
    tax_class: string;
    optional: number | null;
    selected: number | null;
    position: number;
}

export const INVOICES_SQL = `
SELECT i.id, i.client_id, c.name AS client_name, c.email AS client_email, c.phone AS client_phone,
       i.number, ${invoiceStatusSql("i")} AS status,
       i.subtotal_cents, i.tax_total_cents, i.total_cents,
       CASE WHEN i.status = 'draft' THEN i.total_cents
            ELSE COALESCE(${subjectNetSql("receivable", "invoice", "i.id")}, 0) END AS balance_cents,
       CASE WHEN i.status = 'draft' THEN 0
            ELSE i.total_cents - COALESCE(${subjectNetSql("receivable", "invoice", "i.id")}, 0)
       END AS paid_cents,
       (SELECT MAX(pe.occurred_at) FROM entries pe JOIN accounts pa ON pa.id = pe.account_id
        WHERE pa.category = 'receivable' AND pe.subject_type = 'invoice' AND pe.subject_id = i.id
          AND pe.amount_cents < 0) AS paid_at,
       i.issued_at, i.due_at, i.voided_at, i.pay_token, i.notes, i.created_at
FROM invoices i
LEFT JOIN clients c ON c.id = i.client_id
ORDER BY COALESCE(i.issued_at, i.created_at) DESC, i.number DESC`;

export const ESTIMATES_SQL = `
SELECT e.id, e.client_id, c.name AS client_name, c.email AS client_email, c.phone AS client_phone,
       e.number,
       CASE WHEN e.status = 'sent' AND e.valid_until < date('now') THEN 'expired'
            ELSE e.status END AS status,
       e.subtotal_cents, e.tax_total_cents, e.total_cents, e.valid_until, e.accepted_at,
       e.declined_at, e.decline_reason, e.view_token, e.converted_invoice_id,
       ci.number AS converted_number, e.notes, e.created_at
FROM estimates e
LEFT JOIN clients c ON c.id = e.client_id
LEFT JOIN invoices ci ON ci.id = e.converted_invoice_id
ORDER BY e.created_at DESC`;

export const LINES_SQL = `
SELECT id, item_id, booking_id, description, quantity, unit_amount_cents, amount_cents,
       tax_amount_cents, tax_class, optional, selected, position
FROM lines WHERE ? IN (invoice_id, estimate_id) ORDER BY position`;

// Per-code tax is on an issued invoice's journal; a draft's is worked out from its lines.
export const TAX_BY_CODE_SQL = `
SELECT a.code AS code, -SUM(e.amount_cents) AS cents
FROM entries e JOIN accounts a ON a.id = e.account_id
WHERE a.category = 'tax' AND e.ref = ?
GROUP BY a.code ORDER BY a.code`;

export const INVOICE_CREDITS_SQL = `
SELECT e.id, e.event, -e.amount_cents AS cents, e.occurred_at, p.method
FROM entries e
JOIN accounts a ON a.id = e.account_id
LEFT JOIN payments p ON e.source_type = 'payment' AND p.id = e.source_id
WHERE a.category = 'receivable' AND e.subject_type = 'invoice' AND e.subject_id = ?
  AND e.amount_cents < 0 AND e.event IN ('payment', 'application')
ORDER BY e.occurred_at, e.id`;

export const LETTERHEAD_SQL = `
SELECT name, brand, billing_email, gst_hst_number, qst_number FROM businesses LIMIT 1`;

interface CreditRow {
    id: string;
    event: string;
    cents: number;
    occurred_at: string | null;
    method: string | null;
}

interface LetterheadRow {
    name: string | null;
    brand: string | null;
    billing_email: string | null;
    gst_hst_number: string | null;
    qst_number: string | null;
}

export function useInvoices(): InvoiceRow[] {
    return useQuery<InvoiceRow>(INVOICES_SQL).data;
}

export function useEstimates(): EstimateRow[] {
    return useQuery<EstimateRow>(ESTIMATES_SQL).data;
}

export function useLines(parentId: string): LineRow[] {
    return useQuery<LineRow>(LINES_SQL, [parentId]).data;
}

function brandField(brand: string | null, key: string): string | null {
    if (brand === null) return null;
    try {
        const value = (JSON.parse(brand) as Record<string, unknown>)[key];
        return typeof value === "string" && value.trim() !== "" ? value : null;
    } catch {
        return null;
    }
}

export function useLetterhead(): Letterhead {
    const row = useQuery<LetterheadRow>(LETTERHEAD_SQL).data[0];
    return {
        name: row?.name ?? "",
        tagline: brandField(row?.brand ?? null, "tagline"),
        brandColor: brandField(row?.brand ?? null, "primary"),
        email: row?.billing_email ?? null,
        gstHstNumber: row?.gst_hst_number ?? null,
        qstNumber: row?.qst_number ?? null,
    };
}

// ---- tax on the device, the same rule as services/tax.py: per line, per code, half up

type TaxClass = "standard" | "federal_only" | "exempt";

interface DocRate {
    code: string;
    rateBps: number;
}

const FEDERAL = new Set(["GST", "HST"]);

export function docRates(rates: readonly TaxRate[] | null, registered: boolean): DocRate[] {
    if (!registered || rates === null) return [];
    return rates.map((r) => ({ code: r.jurisdiction, rateBps: r.rate_bps }));
}

function asTaxClass(value: string | null | undefined): TaxClass {
    return value === "federal_only" || value === "exempt" ? value : "standard";
}

function codesFor(taxClass: TaxClass, rates: readonly DocRate[]): DocRate[] {
    if (taxClass === "exempt") return [];
    return taxClass === "federal_only" ? rates.filter((r) => FEDERAL.has(r.code)) : [...rates];
}

const ppm = (r: DocRate): number => (r.code === "QST" ? 99_750 : r.rateBps * 100);

interface PricedLine {
    amountCents: number;
    taxClass: TaxClass;
    included: boolean;
}

interface DocPricing {
    lines: { taxByCode: Record<string, number>; taxCents: number; codes: string[] }[];
    taxes: PrintedDocTax[];
    subtotalCents: number;
    taxCents: number;
    totalCents: number;
}

/** Tax per line and per code over the included lines, as the server works it out. */
export function priceDoc(lines: readonly PricedLine[], rates: readonly DocRate[]): DocPricing {
    const priced = lines.map((l) => {
        const taxByCode: Record<string, number> = {};
        for (const r of codesFor(l.taxClass, rates))
            taxByCode[r.code] = Math.round((l.amountCents * ppm(r)) / 1_000_000);
        const taxCents = Object.values(taxByCode).reduce((a, b) => a + b, 0);
        return { taxByCode, taxCents, codes: Object.keys(taxByCode) };
    });
    const kept = lines.map((l, i) => ({ l, t: priced[i] })).filter((x) => x.l.included);
    const taxes: PrintedDocTax[] = rates
        .map((r) => {
            const on = kept.filter((x) => x.t !== undefined && r.code in x.t.taxByCode);
            return {
                code: r.code,
                label: s.taxRow(r.code, ratePct(r.code, r.rateBps)),
                baseCents: on.reduce((sum, x) => sum + x.l.amountCents, 0),
                cents: on.reduce((sum, x) => sum + (x.t?.taxByCode[r.code] ?? 0), 0),
            };
        })
        .filter((t) => t.cents !== 0);
    const subtotalCents = kept.reduce((sum, x) => sum + x.l.amountCents, 0);
    const taxCents = taxes.reduce((sum, t) => sum + t.cents, 0);
    return { lines: priced, taxes, subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

function rateNote(rates: readonly DocRate[]): string {
    return rates.length === 0
        ? s.noTaxNote
        : s.taxNote(rates.map((r) => s.taxRow(r.code, ratePct(r.code, r.rateBps))).join(", "));
}

// ---- statuses and dates

type InvoiceStatus = "draft" | "sent" | "partial" | "overdue" | "paid" | "refunded" | "void";

function invoiceIntent(status: string): Intent {
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
            return "neutral";
    }
}

function estimateStatusIntent(status: string): Intent {
    switch (status) {
        case "accepted":
        case "converted":
            return "success";
        case "sent":
            return "accent";
        case "declined":
            return "danger";
        case "expired":
            return "warning";
        default:
            return "neutral";
    }
}

/** Days past due for an unpaid sent invoice; 0 when it isn't late. */
function daysOverdue(row: InvoiceRow, now: Date = new Date()): number {
    if (row.due_at === null || (row.balance_cents ?? 0) <= 0) return 0;
    if (!["sent", "partial", "overdue"].includes(row.status)) return 0;
    return Math.max(0, -daysUntil(new Date(row.due_at), now));
}

/** The status a person reads: a sent invoice past its due date is overdue the day after. */
function invoiceStatus(row: InvoiceRow, now: Date = new Date()): InvoiceStatus {
    const late = daysOverdue(row, now) > 0;
    if (row.status === "sent" && late) return "overdue";
    return (
        ["draft", "sent", "partial", "overdue", "paid", "refunded", "void"].includes(row.status)
            ? row.status
            : "sent"
    ) as InvoiceStatus;
}

function dueLabel(row: InvoiceRow, status: InvoiceStatus, now: Date): string {
    if (status === "draft") return s.notSent;
    if (status === "void") return s.voidedOn(shortDate(row.voided_at ?? row.created_at));
    if (status === "paid" || status === "refunded") return s.paidOn(shortDate(row.paid_at));
    const late = daysOverdue(row, now);
    if (late > 0) return s.overdueBy(late);
    if (row.due_at === null) return "";
    return daysUntil(new Date(row.due_at), now) === 0 ? s.dueToday : s.dueOn(shortDate(row.due_at));
}

function invoiceLabel(number: number | null): string {
    return number === null ? s.draftInvoice : s.invoiceNo(number);
}

function estimateLabel(number: number | null): string {
    return number === null ? s.draftEstimate : s.estimateNo(number);
}

// ---- the desk

export type InvoiceSegment = "all" | "open" | "overdue" | "draft" | "paid" | "void";
const SEGMENTS: InvoiceSegment[] = ["all", "open", "overdue", "draft", "paid", "void"];

interface InvoiceListRow {
    row: InvoiceRow;
    status: InvoiceStatus;
    statusLabel: string;
    intent: Intent;
    number: string;
    issuedLabel: string;
    dueLabel: string;
    late: boolean;
}

function inSegment(seg: InvoiceSegment, r: InvoiceListRow): boolean {
    switch (seg) {
        case "all":
            return r.status !== "void";
        case "open":
            return ["sent", "partial", "overdue"].includes(r.status);
        case "overdue":
            return r.late;
        case "draft":
            return r.status === "draft";
        case "paid":
            return r.status === "paid" || r.status === "refunded";
        case "void":
            return r.status === "void";
    }
}

function listRow(row: InvoiceRow, now: Date = new Date()): InvoiceListRow {
    const status = invoiceStatus(row, now);
    return {
        row,
        status,
        statusLabel: s.statusLabel[status] ?? status,
        intent: invoiceIntent(status),
        number: row.number === null ? s.dash : s.number(row.number),
        issuedLabel: row.issued_at === null ? s.dash : shortDate(row.issued_at),
        dueLabel: dueLabel(row, status, now),
        late: daysOverdue(row, now) > 0,
    };
}

interface InvoiceStats {
    outstandingCents: number;
    outstandingCount: number;
    overdueCents: number;
    overdueCount: number;
    paid30Cents: number;
    paid30Count: number;
    draftCents: number;
    draftCount: number;
}

function invoiceStats(rows: readonly InvoiceListRow[], now: Date = new Date()): InvoiceStats {
    const open = rows.filter((r) => inSegment("open", r));
    const late = rows.filter((r) => r.late);
    const since = addDays(now, -30).toISOString();
    const paid = rows.filter(
        (r) => (r.status === "paid" || r.status === "refunded") && (r.row.paid_at ?? "") >= since,
    );
    const drafts = rows.filter((r) => r.status === "draft");
    const sum = (xs: InvoiceListRow[], f: (r: InvoiceRow) => number | null): number =>
        xs.reduce((a, r) => a + (f(r.row) ?? 0), 0);
    return {
        outstandingCents: sum(open, (r) => r.balance_cents),
        outstandingCount: open.length,
        overdueCents: sum(late, (r) => r.balance_cents),
        overdueCount: late.length,
        paid30Cents: sum(paid, (r) => r.paid_cents),
        paid30Count: paid.length,
        draftCents: sum(drafts, (r) => r.total_cents),
        draftCount: drafts.length,
    };
}

function searchInvoices<T extends { row: { client_name: string | null; number: number | null } }>(
    rows: readonly T[],
    q: string,
): T[] {
    const t = q.trim().toLowerCase().replace(/^#/, "");
    if (!t) return [...rows];
    return rows.filter(
        (r) =>
            (r.row.client_name ?? "").toLowerCase().includes(t) ||
            (r.row.number !== null && String(r.row.number).includes(t)),
    );
}

interface InvoiceDesk {
    load: Load;
    segment: InvoiceSegment;
    setSegment: (s: InvoiceSegment) => void;
    segments: { key: InvoiceSegment; label: string }[];
    q: string;
    setQ: (q: string) => void;
    rows: InvoiceListRow[];
    stats: InvoiceStats;
    summary: string | undefined;
    emptyMessage: string;
    nothingYet: boolean;
}

/** Invoices with the money strip, segment counts (void left out of All) and search. */
export function useInvoiceDesk(initialSegment: InvoiceSegment = "all"): InvoiceDesk {
    const query = useQuery<InvoiceRow>(INVOICES_SQL);
    const [segment, setSegment] = useState<InvoiceSegment>(initialSegment);
    const [q, setQ] = useState("");
    const all = useMemo(() => query.data.map((r) => listRow(r)), [query.data]);
    const load = useReplicaLoad([query], all.length === 0);
    const rows = useMemo(
        () =>
            searchInvoices(
                all.filter((r) => inSegment(segment, r)),
                q,
            ),
        [all, segment, q],
    );
    const stats = invoiceStats(all);
    const counted = all.filter((r) => r.status !== "void");
    return {
        load,
        segment,
        setSegment,
        segments: SEGMENTS.map((key) => {
            const n = all.filter((r) => inSegment(key, r)).length;
            const label = s.segments[key];
            return { key, label: key !== "all" && n > 0 ? s.segmentCount(label, n) : label };
        }),
        q,
        setQ,
        rows,
        stats,
        summary:
            load.state === "ready"
                ? s.summary(counted.length, formatMoney(stats.outstandingCents))
                : undefined,
        emptyMessage: q !== "" ? s.emptySearch : s.emptySegment(s.segments[segment]),
        nothingYet: all.length === 0,
    };
}

// ---- one invoice

interface DocPaymentView {
    id: string;
    kind: string;
    label: string;
    detail: string;
    amountCents: number;
    pending: boolean;
    refund: boolean;
    payment: PaymentRow;
}

export interface InvoiceRecord {
    row: InvoiceRow;
    title: string;
    status: InvoiceStatus;
    statusLabel: string;
    intent: Intent;
    lines: PrintedDocLine[];
    lineDetail: (line: PrintedDocLine) => string;
    taxes: PrintedDocTax[];
    totals: DocTotalLine[];
    balanceCents: number;
    facts: { label: string; value: string }[];
    payments: DocPaymentView[];
    timeline: TimelineEntry[];
    payUrl: string | null;
    dueLabel: string;
    canEdit: boolean;
    canSend: boolean;
    canRemind: boolean;
    canRecord: boolean;
    canVoid: boolean;
    rateNote: string;
}

function methodLabel(method: string | null): string {
    return s.method[method ?? "other"] ?? s.method.other ?? "";
}

function docLines(lines: readonly LineRow[], pricing: DocPricing): PrintedDocLine[] {
    return lines.map((l, i) => ({
        id: l.id,
        description: l.description,
        subject: null,
        quantity: l.quantity,
        unitCents: l.unit_amount_cents,
        amountCents: l.amount_cents,
        taxCodes: pricing.lines[i]?.codes ?? [],
    }));
}

function lineDetail(line: PrintedDocLine): string {
    const parts = [s.qtyTimes(line.quantity, formatMoney(line.unitCents))];
    if (line.taxCodes.length > 0) parts.push(line.taxCodes.join(" + "));
    return parts.join(" · ");
}

function issuedTaxes(
    pricing: DocPricing,
    journal: readonly { code: string; cents: number }[],
): PrintedDocTax[] {
    if (journal.length === 0) return pricing.taxes;
    return journal
        .filter((t) => t.cents !== 0)
        .map((t) => {
            const computed = pricing.taxes.find((x) => x.code === t.code);
            return {
                code: t.code,
                label: computed?.label ?? t.code,
                baseCents: computed?.baseCents ?? 0,
                cents: t.cents,
            };
        });
}

export function useInvoiceRecord(
    api: ApiLike,
    id: string | null,
    payBase: string,
): InvoiceRecord | null {
    const invoices = useQuery<InvoiceRow>(INVOICES_SQL).data;
    const lines = useQuery<LineRow>(LINES_SQL, [id ?? ""]).data;
    const journal = useQuery<{ code: string; cents: number }>(TAX_BY_CODE_SQL, [
        id === null ? "" : `invoice:${id}`,
    ]).data;
    const credits = useQuery<CreditRow>(INVOICE_CREDITS_SQL, [id ?? ""]).data;
    const payments = useInvoicePayments(id ?? "");
    const tax = useTaxSetup(api);
    const row = invoices.find((r) => r.id === id) ?? null;
    if (row === null) return null;
    const now = new Date();
    const status = invoiceStatus(row, now);
    const rates = docRates(tax.rates, tax.registered);
    const pricing = priceDoc(
        lines.map((l) => ({
            amountCents: l.amount_cents,
            taxClass: asTaxClass(l.tax_class),
            included: true,
        })),
        rates,
    );
    const draft = row.status === "draft";
    const taxes = draft ? pricing.taxes : issuedTaxes(pricing, journal);
    const balanceCents = row.balance_cents ?? 0;
    const totals: DocTotalLine[] = [
        { key: "subtotal", label: s.subtotal, cents: row.subtotal_cents ?? 0, kind: "subtotal" },
        ...taxes.map((t): DocTotalLine => ({
            key: t.code,
            label: t.label,
            cents: t.cents,
            kind: "tax",
        })),
        { key: "total", label: s.total, cents: row.total_cents ?? 0, kind: "total" },
        ...credits.map((c): DocTotalLine => ({
            key: c.id,
            label:
                c.event === "application"
                    ? s.depositApplied
                    : s.paymentOn(methodLabel(c.method), shortDate(c.occurred_at)),
            cents: c.cents,
            kind: "credit",
        })),
    ];
    if (!draft)
        totals.push({ key: "balance", label: s.balanceDue, cents: balanceCents, kind: "balance" });

    const paymentViews: DocPaymentView[] = payments
        .filter((pm) => pm.status !== "failed" && pm.status !== "canceled")
        .map((pm) => ({
            id: pm.id,
            kind: pm.kind,
            label: pm.kind === "refund" ? s.refundBadge : methodLabel(pm.method),
            detail: [
                shortDate(pm.paid_at ?? pm.created_at),
                pm.reference,
                pm.status === "pending" ? s.paymentPending : null,
            ]
                .filter(Boolean)
                .join(" · "),
            amountCents: pm.amount_cents,
            pending: pm.status === "pending",
            refund: pm.kind === "refund",
            payment: pm,
        }));

    const timeline: TimelineEntry[] = [
        {
            key: "created",
            label: s.event.created,
            at: stampLabel(new Date(row.created_at), now),
            intent: "neutral",
        },
    ];
    if (row.issued_at !== null)
        timeline.push({
            key: "sent",
            label: s.event.sent,
            at: stampLabel(new Date(row.issued_at), now),
            intent: "accent",
        });
    for (const c of credits)
        timeline.push({
            key: `c-${c.id}`,
            label:
                c.event === "application"
                    ? s.event.depositApplied(formatMoney(c.cents))
                    : s.event.payment(formatMoney(c.cents), methodLabel(c.method)),
            at: c.occurred_at === null ? "" : stampLabel(new Date(c.occurred_at), now),
            intent: "success",
        });
    for (const pm of payments.filter((x) => x.kind === "refund" && x.status === "succeeded"))
        timeline.push({
            key: `r-${pm.id}`,
            label: s.event.refund(formatMoney(pm.amount_cents)),
            at: stampLabel(new Date(pm.paid_at ?? pm.created_at), now),
            intent: "danger",
        });
    if (row.voided_at !== null)
        timeline.push({
            key: "void",
            label: s.event.voided,
            at: stampLabel(new Date(row.voided_at), now),
            intent: "danger",
        });

    const open = ["sent", "partial", "overdue"].includes(status);
    return {
        row,
        title: invoiceLabel(row.number),
        status,
        statusLabel: s.statusLabel[status] ?? status,
        intent: invoiceIntent(status),
        lines: docLines(lines, pricing),
        lineDetail,
        taxes,
        totals,
        balanceCents,
        facts: [
            {
                label: s.balanceDue,
                value: formatMoney(draft ? (row.total_cents ?? 0) : balanceCents),
            },
            {
                label: s.colIssued,
                value: row.issued_at === null ? s.notSent : shortDate(row.issued_at),
            },
            { label: s.colDue, value: row.due_at === null ? s.dash : shortDate(row.due_at) },
        ],
        payments: paymentViews,
        timeline,
        payUrl: row.pay_token !== null && open ? payLinkUrl(payBase, row.pay_token) : null,
        dueLabel: dueLabel(row, status, now),
        canEdit: draft,
        canSend: draft,
        canRemind: open,
        canRecord: open && balanceCents > 0,
        canVoid:
            draft ||
            (status !== "void" &&
                status !== "paid" &&
                status !== "refunded" &&
                status !== "partial" &&
                (row.paid_cents ?? 0) === 0),
        rateNote: rateNote(rates),
    };
}

interface InvoiceActions {
    busy: boolean;
    error: string | null;
    notice: string | null;
    dismiss: () => void;
    send: (rec: InvoiceRecord) => void;
    remind: (rec: InvoiceRecord) => void;
    voidIt: (rec: InvoiceRecord) => void;
}

/** Send, remind and void: commands whose result reaches every list through the replica. */
export function useInvoiceActions(api: ApiLike): InvoiceActions {
    const { busy, error, setError, run } = useAsyncAction();
    const [notice, setNotice] = useState<string | null>(null);
    const act = (path: string, message: (res: { number: number | null }) => string): void => {
        setNotice(null);
        run(
            async () => {
                setNotice(message(await api.post<{ number: number | null }>(path, {})));
            },
            { errorMessage: s.actionError },
        );
    };
    return {
        busy,
        error,
        notice,
        dismiss: () => {
            setNotice(null);
            setError(null);
        },
        send: (rec) => {
            act(`/v1/invoices/${rec.row.id}/send`, (res) =>
                s.invoiceSentTo(res.number ?? 0, rec.row.client_name ?? ""),
            );
        },
        remind: (rec) => {
            act(`/v1/invoices/${rec.row.id}/send`, () =>
                s.reminderSentTo(rec.row.client_name ?? ""),
            );
        },
        voidIt: (rec) => {
            act(`/v1/invoices/${rec.row.id}/void`, () => s.invoiceVoided(rec.title));
        },
    };
}

function partyLines(r: { client_email: string | null; client_phone: string | null }): string[] {
    return [r.client_email, r.client_phone === null ? null : formatPhone(r.client_phone)].filter(
        (x): x is string => x !== null && x !== "",
    );
}

export function printedInvoice(
    rec: InvoiceRecord,
    letterhead: Letterhead,
    fallbackColor: string,
): PrintedDoc {
    const r = rec.row;
    const paid = rec.status === "paid" || rec.status === "refunded";
    return printedDoc(
        {
            kind: "invoice",
            number: r.number === null ? p.draftNumber : String(r.number),
            partyName: r.client_name ?? "",
            partyLines: partyLines(r),
            meta: [
                {
                    label: p.invoiceNumber,
                    value: r.number === null ? p.draftNumber : s.number(r.number),
                },
                {
                    label: p.issued,
                    value: r.issued_at === null ? s.notSent : longDate(r.issued_at),
                },
                { label: p.due, value: r.due_at === null ? s.dash : longDate(r.due_at) },
            ],
            lines: rec.lines,
            taxes: rec.taxes,
            totals: rec.totals,
            headline: {
                label: s.balanceDue,
                cents: rec.status === "draft" ? (r.total_cents ?? 0) : rec.balanceCents,
            },
            stamp: paid ? p.paidStamp : null,
            payUrl: paid ? null : rec.payUrl,
            instructions: paid
                ? []
                : [
                      ...(rec.payUrl !== null ? [p.payOnline(rec.payUrl)] : []),
                      ...(letterhead.email !== null ? [p.payInterac(letterhead.email)] : []),
                  ],
            message: r.notes,
        },
        letterhead,
        fallbackColor,
    );
}

export function printedReceipt(
    rec: InvoiceRecord,
    paymentId: string,
    letterhead: Letterhead,
    fallbackColor: string,
): PrintedDoc | null {
    const pay = rec.payments.find((x) => x.id === paymentId && !x.refund);
    if (pay === undefined) return null;
    const r = rec.row;
    const at = pay.payment.paid_at ?? pay.payment.created_at;
    return printedDoc(
        {
            kind: "receipt",
            number: `${String(r.number ?? "")}-${String(rec.payments.filter((x) => !x.refund).indexOf(pay) + 1)}`,
            partyName: r.client_name ?? "",
            partyLines: partyLines(r),
            meta: [
                { label: p.paidOn, value: longDate(at) },
                { label: p.forInvoice, value: r.number === null ? s.dash : s.number(r.number) },
            ],
            lines: rec.lines,
            taxes: rec.taxes,
            totals: [
                { key: "total", label: p.forInvoice, cents: r.total_cents ?? 0, kind: "subtotal" },
                { key: "paid", label: p.amountPaid, cents: pay.amountCents, kind: "credit" },
                {
                    key: "balance",
                    label: p.balanceRemaining,
                    cents: rec.balanceCents,
                    kind: "balance",
                },
            ],
            headline: { label: p.amountPaid, cents: pay.amountCents },
            payment: {
                method: pay.label,
                reference: pay.payment.reference ?? "",
                at: longDate(at),
                amountCents: pay.amountCents,
            },
            stamp: rec.balanceCents === 0 ? p.paidStamp : null,
            payUrl: rec.balanceCents > 0 ? rec.payUrl : null,
            instructions:
                rec.balanceCents > 0 && rec.payUrl !== null ? [p.payOnline(rec.payUrl)] : [],
        },
        letterhead,
        fallbackColor,
    );
}

// ---- estimates

export type EstimateSegment = "all" | "draft" | "sent" | "accepted" | "closed";
const ESTIMATE_SEGMENTS: EstimateSegment[] = ["all", "draft", "sent", "accepted", "closed"];

interface EstimateListRow {
    row: EstimateRow;
    status: string;
    statusLabel: string;
    intent: Intent;
    number: string;
    validLabel: string;
}

function estimateShown(row: EstimateRow): string {
    return row.converted_invoice_id !== null ? "converted" : row.status;
}

function validLabel(row: EstimateRow, status: string, now: Date): string {
    if (status === "converted")
        return s.convertedTo(
            row.converted_number === null ? s.dash : s.number(row.converted_number),
        );
    if (status === "accepted") return s.acceptedOn(shortDate(row.accepted_at));
    if (status === "declined") return s.declinedOn(shortDate(row.declined_at));
    if (row.valid_until === null) return s.notSent;
    if (status === "expired") return s.expiredOn(shortDate(row.valid_until));
    const left = daysUntil(new Date(`${row.valid_until}T23:59:00`), now);
    return status === "sent" && left <= 7
        ? s.expiresIn(Math.max(0, left))
        : s.validUntil(shortDate(row.valid_until));
}

function estimateListRow(row: EstimateRow, now: Date): EstimateListRow {
    const status = estimateShown(row);
    return {
        row,
        status,
        statusLabel: s.estimateStatus[status] ?? status,
        intent: estimateStatusIntent(status),
        number: row.number === null ? s.dash : s.number(row.number),
        validLabel: validLabel(row, status, now),
    };
}

function inEstimateSegment(seg: EstimateSegment, r: EstimateListRow): boolean {
    switch (seg) {
        case "all":
            return true;
        case "draft":
            return r.status === "draft";
        case "sent":
            return r.status === "sent";
        case "accepted":
            return r.status === "accepted";
        case "closed":
            return ["converted", "declined", "expired"].includes(r.status);
    }
}

interface EstimateDesk {
    load: Load;
    segment: EstimateSegment;
    setSegment: (s: EstimateSegment) => void;
    segments: { key: EstimateSegment; label: string }[];
    q: string;
    setQ: (q: string) => void;
    rows: EstimateListRow[];
    summary: string | undefined;
    emptyMessage: string;
    nothingYet: boolean;
}

export function useEstimateDesk(): EstimateDesk {
    const query = useQuery<EstimateRow>(ESTIMATES_SQL);
    const [segment, setSegment] = useState<EstimateSegment>("all");
    const [q, setQ] = useState("");
    const all = useMemo(() => query.data.map((r) => estimateListRow(r, new Date())), [query.data]);
    const load = useReplicaLoad([query], all.length === 0);
    const rows = useMemo(
        () =>
            searchInvoices(
                all.filter((r) => inEstimateSegment(segment, r)),
                q,
            ),
        [all, segment, q],
    );
    const waiting = all
        .filter((r) => r.status === "sent")
        .reduce((a, r) => a + (r.row.total_cents ?? 0), 0);
    return {
        load,
        segment,
        setSegment,
        segments: ESTIMATE_SEGMENTS.map((key) => {
            const n = all.filter((r) => inEstimateSegment(key, r)).length;
            const label = s.estimateSegments[key];
            return { key, label: key !== "all" && n > 0 ? s.segmentCount(label, n) : label };
        }),
        q,
        setQ,
        rows,
        summary:
            load.state === "ready"
                ? s.estimatesSummary(all.length, formatMoney(waiting))
                : undefined,
        emptyMessage:
            q !== "" ? s.emptySearch : s.emptyEstimateSegment(s.estimateSegments[segment]),
        nothingYet: all.length === 0,
    };
}

interface EstimateLineView extends PrintedDocLine {
    optional: boolean;
    selected: boolean;
    note: string | null;
}

export interface EstimateRecord {
    row: EstimateRow;
    title: string;
    status: string;
    statusLabel: string;
    intent: Intent;
    validLabel: string;
    lines: EstimateLineView[];
    lineDetail: (line: PrintedDocLine) => string;
    taxes: PrintedDocTax[];
    totals: DocTotalLine[];
    timeline: TimelineEntry[];
    acceptUrl: string | null;
    canEdit: boolean;
    canSend: boolean;
    canMark: boolean;
    canConvert: boolean;
    rateNote: string;
}

function estimateLinkUrl(base: string, token: string): string {
    return `${base.replace(/\/+$/, "")}/e/${encodeURIComponent(token)}`;
}

export function useEstimateRecord(
    api: ApiLike,
    id: string | null,
    payBase: string,
): EstimateRecord | null {
    const estimates = useQuery<EstimateRow>(ESTIMATES_SQL).data;
    const lines = useQuery<LineRow>(LINES_SQL, [id ?? ""]).data;
    const tax = useTaxSetup(api);
    const row = estimates.find((e) => e.id === id) ?? null;
    if (row === null) return null;
    const now = new Date();
    const view = estimateListRow(row, now);
    const rates = docRates(tax.rates, tax.registered);
    const included = (l: LineRow): boolean => l.optional !== 1 || l.selected === 1;
    const pricing = priceDoc(
        lines.map((l) => ({
            amountCents: l.amount_cents,
            taxClass: asTaxClass(l.tax_class),
            included: included(l),
        })),
        rates,
    );
    const answered = row.status === "accepted" || row.converted_invoice_id !== null;
    const timeline: TimelineEntry[] = [
        {
            key: "created",
            label: s.event.created,
            at: stampLabel(new Date(row.created_at), now),
            intent: "neutral",
        },
    ];
    if (row.number !== null)
        timeline.push({ key: "sent", label: s.event.sent, at: "", intent: "accent" });
    if (row.accepted_at !== null)
        timeline.push({
            key: "accepted",
            label: s.event.accepted,
            at: stampLabel(new Date(row.accepted_at), now),
            intent: "success",
        });
    if (row.declined_at !== null)
        timeline.push({
            key: "declined",
            label: s.event.declined,
            at: stampLabel(new Date(row.declined_at), now),
            intent: "danger",
            quote: row.decline_reason ?? undefined,
        });
    if (row.converted_number !== null)
        timeline.push({
            key: "converted",
            label: s.event.converted(s.number(row.converted_number)),
            at: "",
            intent: "success",
        });
    return {
        row,
        title: estimateLabel(row.number),
        status: view.status,
        statusLabel: view.statusLabel,
        intent: view.intent,
        validLabel: view.validLabel,
        lines: docLines(lines, pricing).map((l, i) => {
            const src = lines[i];
            const optional = src?.optional === 1;
            const selected = src?.selected === 1;
            return {
                ...l,
                optional,
                selected,
                note: !optional
                    ? null
                    : answered
                      ? selected
                          ? s.addOnPicked
                          : s.addOnNotPicked
                      : s.addOnOffered,
            };
        }),
        lineDetail,
        taxes: pricing.taxes,
        totals: [
            {
                key: "subtotal",
                label: s.subtotal,
                cents: row.subtotal_cents ?? 0,
                kind: "subtotal",
            },
            ...pricing.taxes.map((t): DocTotalLine => ({
                key: t.code,
                label: t.label,
                cents: t.cents,
                kind: "tax",
            })),
            { key: "total", label: s.total, cents: row.total_cents ?? 0, kind: "total" },
        ],
        timeline,
        acceptUrl: row.view_token !== null ? estimateLinkUrl(payBase, row.view_token) : null,
        canEdit: view.status === "draft" || view.status === "sent",
        canSend: view.status === "draft",
        canMark: view.status === "sent",
        canConvert:
            (view.status === "sent" || view.status === "accepted") &&
            row.converted_invoice_id === null,
        rateNote: rateNote(rates),
    };
}

interface EstimateActions {
    busy: boolean;
    error: string | null;
    notice: string | null;
    dismiss: () => void;
    send: (rec: EstimateRecord) => void;
    accept: (rec: EstimateRecord) => void;
    decline: (rec: EstimateRecord) => void;
    convert: (rec: EstimateRecord, onDone?: (invoiceId: string) => void) => void;
}

export function useEstimateActions(api: ApiLike): EstimateActions {
    const { busy, error, setError, run } = useAsyncAction();
    const [notice, setNotice] = useState<string | null>(null);
    const convertKey = useRef<string | null>(null);
    const act = <T>(
        call: () => Promise<T>,
        message: (res: T) => string,
        done?: (res: T) => void,
    ): void => {
        setNotice(null);
        run(
            async () => {
                const res = await call();
                setNotice(message(res));
                done?.(res);
            },
            { errorMessage: s.actionError },
        );
    };
    return {
        busy,
        error,
        notice,
        dismiss: () => {
            setNotice(null);
            setError(null);
        },
        send: (rec) => {
            act(
                () => api.post<{ number: number | null }>(`/v1/estimates/${rec.row.id}/send`, {}),
                (res) => s.estimateSentTo(res.number ?? 0, rec.row.client_name ?? ""),
            );
        },
        accept: (rec) => {
            act(
                () => api.post(`/v1/estimates/${rec.row.id}/accept`, {}),
                () => s.estimateMarkedAccepted(rec.title),
            );
        },
        decline: (rec) => {
            act(
                () => api.post(`/v1/estimates/${rec.row.id}/decline`, {}),
                () => s.estimateMarkedDeclined(rec.title),
            );
        },
        convert: (rec, onDone) => {
            convertKey.current ??= newIdempotencyKey();
            const key = convertKey.current;
            act(
                () =>
                    api.post<{ id: string }>(
                        `/v1/estimates/${rec.row.id}/convert`,
                        {},
                        { idempotencyKey: key },
                    ),
                () => s.convertedDraft,
                (res) => {
                    convertKey.current = null;
                    onDone?.(res.id);
                },
            );
        },
    };
}

export function printedEstimate(
    rec: EstimateRecord,
    letterhead: Letterhead,
    fallbackColor: string,
): PrintedDoc {
    const r = rec.row;
    return printedDoc(
        {
            kind: "estimate",
            number: r.number === null ? p.draftNumber : String(r.number),
            partyName: r.client_name ?? "",
            partyLines: partyLines(r),
            meta: [
                {
                    label: p.estimateNumber,
                    value: r.number === null ? p.draftNumber : s.number(r.number),
                },
                { label: p.issued, value: longDate(r.created_at) },
                {
                    label: p.validUntil,
                    value: r.valid_until === null ? s.dash : longDate(r.valid_until),
                },
            ],
            lines: rec.lines.filter((l) => !l.optional || l.selected),
            taxes: rec.taxes,
            totals: rec.totals,
            headline: { label: p.estimateTotal, cents: r.total_cents ?? 0 },
            payUrl: rec.acceptUrl,
            instructions: [
                ...(rec.acceptUrl !== null ? [p.acceptOnline(rec.acceptUrl)] : []),
                ...(r.valid_until !== null ? [p.acceptBy(longDate(r.valid_until))] : []),
            ],
            message: r.notes,
        },
        letterhead,
        fallbackColor,
    );
}

// ---- the composer, shared by invoices and estimates

export type DocTerms = "receipt" | "d7" | "d14" | "d30";
const TERM_DAYS: Record<DocTerms, number> = { receipt: 0, d7: 7, d14: 14, d30: 30 };
const DOC_TERMS: DocTerms[] = ["receipt", "d7", "d14", "d30"];
const ESTIMATE_TERMS: DocTerms[] = ["d7", "d14", "d30"];

interface DraftLine {
    description: string;
    quantity: string;
    unit: string;
    itemId: string | null;
    taxClass: TaxClass;
    optional: boolean;
}

interface ComposerLine extends DraftLine {
    key: string;
    amountCents: number;
    taxCodes: string[];
    error: string | null;
}

/** An existing draft opened for editing: its client stays fixed, everything else is editable. */
export interface DocDraft {
    id: string;
    number: number | null;
    clientId: string;
    notes: string;
    lines: DraftLine[];
}

export function docDraft(row: InvoiceRow | EstimateRow, lines: readonly LineRow[]): DocDraft {
    return {
        id: row.id,
        number: row.number,
        clientId: row.client_id,
        notes: row.notes ?? "",
        lines: lines.map((l) => ({
            description: l.description,
            quantity: String(l.quantity),
            unit: (l.unit_amount_cents / 100).toFixed(2),
            itemId: l.item_id,
            taxClass: asTaxClass(l.tax_class),
            optional: l.optional === 1,
        })),
    };
}

let lineSeq = 0;
const keyed = (line: DraftLine): DraftLine & { key: string } => ({
    ...line,
    key: `l${String((lineSeq += 1))}`,
});
const blankLine = (): DraftLine & { key: string } =>
    keyed({
        description: "",
        quantity: "1",
        unit: "",
        itemId: null,
        taxClass: "standard",
        optional: false,
    });

const qtyOf = (l: DraftLine): number => Number(l.quantity) || 0;
const unitOf = (l: DraftLine): number => parseCents(l.unit) ?? 0;
const isBlank = (l: DraftLine): boolean => l.description.trim() === "" && l.unit.trim() === "";

interface DocComposer {
    kind: "invoice" | "estimate";
    editing: boolean;
    title: string;
    clientId: string;
    setClientId: (id: string) => void;
    lines: ComposerLine[];
    setLine: (key: string, patch: Partial<DraftLine>) => void;
    addLine: () => void;
    removeLine: (key: string) => void;
    addCatalogItem: (item: {
        id: string;
        name: string;
        price_cents: number | null;
        tax_class: string;
    }) => void;
    terms: DocTerms;
    setTerms: (t: DocTerms) => void;
    termOptions: { key: DocTerms; label: string }[];
    taxClassOptions: { key: string; label: string }[];
    message: string;
    setMessage: (v: string) => void;
    pricing: DocPricing;
    totals: DocTotalLine[];
    rateNote: string;
    dirty: boolean;
    clientError: string | null;
    linesError: string | null;
    busy: boolean;
    sending: boolean;
    error: string | null;
    saved: string | null;
    sent: string | null;
    saveDraft: () => void;
    send: () => void;
    startOver: () => void;
    preview: (
        client: { name: string | null; email: string | null; phone: string | null } | null,
        letterhead: Letterhead,
        fallbackColor: string,
    ) => PrintedDoc;
}

/** The invoice and estimate composer: lines with their tax class, live totals, save or send in one call. */
export function useDocComposer(
    api: ApiLike,
    kind: "invoice" | "estimate",
    draft?: DocDraft,
    onDone?: (id: string) => void,
): DocComposer {
    const [clientId, setClientId] = useState(draft?.clientId ?? "");
    const [lines, setLines] = useState(() =>
        draft !== undefined && draft.lines.length > 0 ? draft.lines.map(keyed) : [blankLine()],
    );
    const [message, setMessage] = useState(draft?.notes ?? "");
    const [terms, setTerms] = useState<DocTerms>(kind === "estimate" ? "d14" : "d14");
    const [attempted, setAttempted] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [saved, setSaved] = useState<string | null>(null);
    const [sent, setSent] = useState<string | null>(null);
    const [docId, setDocId] = useState<string | null>(draft?.id ?? null);
    const save = useAsyncAction();
    const sendAction = useAsyncAction();
    const keyRef = useRef<string | null>(null);
    const tax = useTaxSetup(api);
    const rates = docRates(tax.rates, tax.registered);

    const touch = (): void => {
        setDirty(true);
        setSaved(null);
        keyRef.current = null;
    };
    const pricing = priceDoc(
        lines.map((l) => ({
            amountCents: Math.round(qtyOf(l) * unitOf(l)),
            taxClass: l.taxClass,
            included: !isBlank(l) && !l.optional,
        })),
        rates,
    );
    const composerLines: ComposerLine[] = lines.map((l, i) => {
        const incomplete =
            !isBlank(l) && (l.description.trim() === "" || unitOf(l) <= 0 || qtyOf(l) <= 0);
        return {
            ...l,
            amountCents: Math.round(qtyOf(l) * unitOf(l)),
            taxCodes: pricing.lines[i]?.codes ?? [],
            error: attempted && incomplete ? s.lineIncomplete : null,
        };
    });
    const filled = lines.filter((l) => !isBlank(l));
    const valid =
        clientId !== "" &&
        filled.some((l) => !l.optional) &&
        !composerLines.some(
            (l) => !isBlank(l) && (l.description.trim() === "" || l.amountCents <= 0),
        );

    const body = (withSend: boolean): Record<string, unknown> => {
        const due = addDays(new Date(), TERM_DAYS[terms]);
        return {
            ...(draft === undefined && docId === null ? { client_id: clientId } : {}),
            lines: filled.map((l) => ({
                description: l.description.trim(),
                quantity: qtyOf(l),
                unit_amount_cents: unitOf(l),
                item_id: l.itemId,
                tax_class: l.taxClass,
                ...(kind === "estimate" ? { optional: l.optional } : {}),
            })),
            notes: blankToNull(message),
            ...(kind === "invoice"
                ? { due_at: due.toISOString() }
                : { valid_until: due.toISOString().slice(0, 10) }),
            ...(withSend && draft === undefined && docId === null ? { send: true } : {}),
        };
    };
    const path = kind === "invoice" ? "/v1/invoices" : "/v1/estimates";

    const saveDraft = (): void => {
        setAttempted(true);
        if (!valid) return;
        keyRef.current ??= newIdempotencyKey();
        const key = keyRef.current;
        save.run(
            async () => {
                if (docId !== null) {
                    await api.patch(`${path}/${docId}`, body(false));
                } else {
                    const created = await api.post<{ id: string }>(path, body(false), {
                        idempotencyKey: key,
                    });
                    setDocId(created.id);
                }
                setDirty(false);
                setSaved(s.draftSaved);
            },
            { errorMessage: s.saveError },
        );
    };

    const send = (): void => {
        setAttempted(true);
        if (!valid) return;
        keyRef.current ??= newIdempotencyKey();
        const key = keyRef.current;
        sendAction.run(
            async () => {
                let id = docId;
                if (id === null) {
                    id = (await api.post<{ id: string }>(path, body(true), { idempotencyKey: key }))
                        .id;
                } else {
                    await api.patch(`${path}/${id}`, body(false));
                    await api.post(`${path}/${id}/send`, {});
                }
                setDocId(id);
                setDirty(false);
                setSent(s.sentTitle(s.doc.kinds[kind]));
                onDone?.(id);
            },
            { errorMessage: s.sendError },
        );
    };

    const totals: DocTotalLine[] = [
        { key: "subtotal", label: s.subtotal, cents: pricing.subtotalCents, kind: "subtotal" },
        ...pricing.taxes.map((t): DocTotalLine => ({
            key: t.code,
            label: t.label,
            cents: t.cents,
            kind: "tax",
        })),
        { key: "total", label: s.total, cents: pricing.totalCents, kind: "total" },
    ];
    const termOptions = (kind === "estimate" ? ESTIMATE_TERMS : DOC_TERMS).map((key) => ({
        key,
        label: s.terms[key],
    }));

    return {
        kind,
        editing: draft !== undefined,
        title:
            kind === "invoice"
                ? draft?.number != null
                    ? s.invoiceNo(draft.number)
                    : draft !== undefined
                      ? s.draftInvoice
                      : s.newInvoice
                : draft?.number != null
                  ? s.estimateNo(draft.number)
                  : draft !== undefined
                    ? s.draftEstimate
                    : s.newEstimate,
        clientId,
        setClientId: (id) => {
            touch();
            setClientId(id);
        },
        lines: composerLines,
        setLine: (key, patch) => {
            touch();
            setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
        },
        addLine: () => {
            touch();
            setLines((ls) => [...ls, blankLine()]);
        },
        removeLine: (key) => {
            touch();
            setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : [blankLine()]));
        },
        addCatalogItem: (item) => {
            touch();
            const line = keyed({
                description: item.name,
                quantity: "1",
                unit: ((item.price_cents ?? 0) / 100).toFixed(2),
                itemId: item.id,
                taxClass: asTaxClass(item.tax_class),
                optional: false,
            });
            setLines((ls) => {
                const last = ls.at(-1);
                return last !== undefined && isBlank(last)
                    ? [...ls.slice(0, -1), line]
                    : [...ls, line];
            });
        },
        terms,
        setTerms: (t) => {
            touch();
            setTerms(t);
        },
        termOptions,
        taxClassOptions: taxOptions(tax.rates),
        message,
        setMessage: (v) => {
            touch();
            setMessage(v);
        },
        pricing,
        totals,
        rateNote: rateNote(rates),
        dirty,
        clientError: attempted && clientId === "" ? s.needClient : null,
        linesError: attempted && !filled.some((l) => !l.optional) ? s.needLine : null,
        busy: save.busy,
        sending: sendAction.busy,
        error: save.error ?? sendAction.error,
        saved,
        sent,
        saveDraft,
        send,
        startOver: () => {
            setSent(null);
            setSaved(null);
            setAttempted(false);
            setDirty(false);
            setDocId(null);
            setClientId("");
            setMessage("");
            setLines([blankLine()]);
            keyRef.current = null;
        },
        preview: (client, letterhead, fallbackColor) => {
            const estimate = kind === "estimate";
            const until = addDays(new Date(), TERM_DAYS[terms]).toISOString();
            const shown = composerLines.filter(
                (l) => !isBlank(l) && l.amountCents > 0 && !l.optional,
            );
            const number = draft?.number != null ? String(draft.number) : p.draftNumber;
            return printedDoc(
                {
                    kind,
                    number,
                    partyName: client?.name ?? s.chooseClient,
                    partyLines:
                        client === null
                            ? []
                            : partyLines({
                                  client_email: client.email,
                                  client_phone: client.phone,
                              }),
                    meta: [
                        { label: estimate ? p.estimateNumber : p.invoiceNumber, value: number },
                        { label: p.issued, value: longDate(new Date().toISOString()) },
                        { label: estimate ? p.validUntil : p.due, value: longDate(until) },
                    ],
                    lines: shown.map((l) => ({
                        id: l.key,
                        description: l.description,
                        subject: null,
                        quantity: qtyOf(l),
                        unitCents: unitOf(l),
                        amountCents: l.amountCents,
                        taxCodes: l.taxCodes,
                    })),
                    taxes: pricing.taxes,
                    totals,
                    headline: {
                        label: estimate ? p.estimateTotal : s.balanceDue,
                        cents: pricing.totalCents,
                    },
                    instructions: estimate
                        ? [p.acceptBy(longDate(until))]
                        : letterhead.email !== null
                          ? [p.payInterac(letterhead.email)]
                          : [],
                    message: blankToNull(message),
                },
                letterhead,
                fallbackColor,
            );
        },
    };
}
