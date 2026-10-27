import { useBusinessQuery as useQuery } from "../hooks";

import { useMemo, useRef, useState } from "react";

import { type ApiLike, type Attempt, attemptKey, failedCode, failureMessage } from "../api";
import { daysUntil, formatDate, parseTimestamp, startOfMonth, useBusinessZone } from "../datetime";
import { formatCredit, formatMoney, formatParts, parseCents, BUSINESS_CURRENCY } from "../format";
import { type Load, type Remote, useAsyncAction, useRemote } from "../hooks";
import { strings } from "../strings";
import type { DocTotalLine, Intent, TimelineEntry } from "../ui";
import { useReplicaLoad } from "./sync";

const s = strings.refunds;
const FEE_CATEGORIES = "('processing_fee', 'platform_fee')";

interface RefundablePaymentRow {
    client_id: string | null;
    id: string;
    client_name: string | null;
    kind: string;
    method: string;
    provider: string;
    amount_cents: number;
    paid_at: string | null;
    created_at: string;
    invoice_number: number | null;
    order_number: number | null;
    booking_id: string | null;
    gift_code: string | null;
    package_name: string | null;
    refunded_cents: number;
    fee_cents: number;
}

export const REFUNDABLE_PAYMENTS_SQL = `
SELECT p.id, p.client_id, c.name AS client_name, p.kind, p.method, p.provider, p.amount_cents, p.paid_at,
       p.created_at, i.number AS invoice_number, o.number AS order_number, p.booking_id,
       g.code AS gift_code, pi.name AS package_name,
       COALESCE((SELECT SUM(r.amount_cents) FROM payments r
                 WHERE r.parent_payment_id = p.id AND r.kind = 'refund'
                   AND r.status = 'succeeded'), 0) AS refunded_cents,
       COALESCE((SELECT SUM(fe.amount_cents) FROM entries fe
                 JOIN accounts fa ON fa.id = fe.account_id
                 WHERE fe.ref = 'fee:' || p.id AND fa.category IN ${FEE_CATEGORIES}), 0) AS fee_cents
FROM payments p
LEFT JOIN clients c ON c.id = p.client_id
LEFT JOIN invoices i ON i.id = p.invoice_id
LEFT JOIN orders o ON o.id = p.order_id
LEFT JOIN gift_cards g ON g.payment_id = p.id
LEFT JOIN packages pk ON pk.payment_id = p.id
LEFT JOIN items pi ON pi.id = pk.item_id
WHERE p.kind IN ('payment', 'deposit') AND p.status = 'succeeded'
ORDER BY COALESCE(p.paid_at, p.created_at) DESC
LIMIT 200`;

export interface RefundRow {
    id: string;
    parent_payment_id: string;
    amount_cents: number;
    paid_at: string | null;
    created_at: string;
    reason: string | null;
    credit_note: string | null;
    status: string;
    client_name: string | null;
    invoice_number: number | null;
    order_number: number | null;
    gift_code: string | null;
    package_name: string | null;
    booking_id: string | null;
}

export const CREDIT_NOTES_SQL = `
SELECT r.id, r.parent_payment_id, r.amount_cents, r.paid_at, r.created_at, r.reason,
       r.credit_note, r.status, c.name AS client_name, i.number AS invoice_number,
       o.number AS order_number, g.code AS gift_code, pi.name AS package_name, p.booking_id
FROM payments r
JOIN payments p ON p.id = r.parent_payment_id
LEFT JOIN clients c ON c.id = p.client_id
LEFT JOIN invoices i ON i.id = p.invoice_id
LEFT JOIN orders o ON o.id = p.order_id
LEFT JOIN gift_cards g ON g.payment_id = p.id
LEFT JOIN packages pk ON pk.payment_id = p.id
LEFT JOIN items pi ON pi.id = pk.item_id
WHERE r.kind = 'refund'
ORDER BY COALESCE(r.paid_at, r.created_at) DESC`;

interface SubjectFields {
    invoice_number: number | null;
    order_number: number | null;
    gift_code: string | null;
    package_name: string | null;
    booking_id: string | null;
}

/** What a payment paid for, in the words the refund desk and credit notes use. */
function paymentSubject(p: SubjectFields): string {
    if (p.invoice_number !== null) return s.subject.invoice(p.invoice_number);
    if (p.order_number !== null) return s.subject.sale(p.order_number);
    if (p.gift_code !== null) return s.subject.giftCard(p.gift_code);
    if (p.package_name !== null) return p.package_name;
    if (p.booking_id !== null) return s.subject.deposit;
    return s.subject.payment;
}

export function methodLabel(method: string): string {
    return s.method[method] ?? s.method.other;
}

type RefundState = "paid" | "partly_refunded" | "refunded";

export function refundState(p: RefundablePaymentRow): RefundState {
    if (p.refunded_cents <= 0) return "paid";
    return p.refunded_cents >= p.amount_cents ? "refunded" : "partly_refunded";
}

function refundStateIntent(state: string): Intent {
    return state === "refunded" ? "neutral" : state === "partly_refunded" ? "warning" : "success";
}

export interface RefundSummary {
    payment: RefundablePaymentRow;
    subject: string;
    method: string;
    when: string;
    state: RefundState;
    stateLabel: string;
    intent: Intent;
    leftCents: number;
}

function summarize(p: RefundablePaymentRow, zone: string): RefundSummary {
    const state = refundState(p);
    return {
        payment: p,
        subject: paymentSubject(p),
        method: methodLabel(p.method),
        when: formatDate(parseTimestamp(p.paid_at ?? p.created_at), zone),
        state,
        stateLabel: s.statusLabel[state],
        intent: refundStateIntent(state),
        leftCents: Math.max(0, p.amount_cents - p.refunded_cents),
    };
}

interface RefundDesk {
    load: Load;
    q: string;
    setQ: (q: string) => void;
    rows: RefundSummary[];
    selectedId: string | null;
    select: (id: string | null) => void;
    selected: RefundSummary | null;
    refunds: RefundRow[];
}

/** Recent payments to refund, the one being refunded, and every credit note issued. */
export function useRefundDesk(initialId: string | null = null): RefundDesk {
    const paymentsQuery = useQuery<RefundablePaymentRow>(REFUNDABLE_PAYMENTS_SQL);
    const notesQuery = useQuery<RefundRow>(CREDIT_NOTES_SQL);
    const load = useReplicaLoad([paymentsQuery, notesQuery], paymentsQuery.data.length === 0);
    const [q, setQ] = useState("");
    const [selectedId, select] = useState<string | null>(initialId);
    const zone = useBusinessZone();
    const all = useMemo(
        () => paymentsQuery.data.map((p) => summarize(p, zone)),
        [paymentsQuery.data, zone],
    );
    const t = q.trim().toLowerCase();
    const rows =
        t === ""
            ? all
            : all.filter((r) =>
                  [r.payment.client_name ?? "", r.subject, r.method].some((v) =>
                      v.toLowerCase().includes(t),
                  ),
              );
    return {
        load,
        q,
        setQ,
        rows,
        selectedId,
        select,
        selected: all.find((r) => r.payment.id === selectedId) ?? null,
        refunds: notesQuery.data,
    };
}

interface RefundPart {
    category: string;
    code: string;
    cents: number;
}

type RefundBlock = keyof typeof s.blocked;

function isRefundBlock(code: string | null): code is RefundBlock {
    return code !== null && Object.hasOwn(s.blocked, code);
}

/** A refused refund names why with the same code its preview shows. */
function refundFailure(e: unknown): string {
    const code = failedCode(e);
    return (isRefundBlock(code) ? s.blocked[code] : undefined) ?? failureMessage(e, s.refundError);
}

interface RefundPreview {
    payment_id: string;
    amount_cents: number;
    refunded_cents: number;
    left_cents: number;
    fee_cents: number;
    refund_cents: number;
    whole_only: boolean;
    blocked: RefundBlock | null;
    by_hand: boolean;
    next_credit_note: string;
    parts: RefundPart[];
}

interface RefundResult {
    refund_id: string;
    status: string;
    credit_note: string | null;
}

export function partLabel(part: RefundPart): string {
    if (part.category === "tax") return s.part_tax(part.code);
    if (part.category === "deferred") return s.part_deferred;
    if (part.category === "gift_card") return s.part_gift_card;
    if (part.category === "deposit") return s.part_deposit;
    if (part.category === "staff_cost") return s.part_tip;
    return s.part_revenue;
}

type RefundMode = "full" | "part";
const REFUND_REASONS = Object.keys(s.reasons);

interface RefundComposer {
    preview: Remote<RefundPreview>;
    blocked: string | null;
    wholeOnly: boolean;
    byHand: boolean;
    leftCents: number;
    mode: RefundMode;
    setMode: (m: RefundMode) => void;
    modes: { key: RefundMode; label: string; disabled?: boolean }[];
    amount: string;
    setAmount: (v: string) => void;
    amountPlaceholder: string;
    reason: string;
    setReason: (v: string) => void;
    reasons: { key: string; label: string }[];
    notify: boolean;
    setNotify: (v: boolean) => void;
    cents: number;
    valid: boolean;
    lines: DocTotalLine[];
    feeNote: string | null;
    nextNote: string;
    submitLabel: string;
    confirmTitle: string;
    confirmBody: string;
    busy: boolean;
    error: string | null;
    submit: () => void;
    issued: string | null;
    history: TimelineEntry[];
}

/** A refund of all or part of what's left, previewed by the server's own credit-note split. */
export function useRefundComposer(
    api: ApiLike,
    summary: RefundSummary,
    refunds: readonly RefundRow[],
): RefundComposer {
    const p = summary.payment;
    const zone = useBusinessZone();
    const [mode, setModeState] = useState<RefundMode>("full");
    const [amount, setAmountState] = useState("");
    const [reason, setReason] = useState<string>(REFUND_REASONS[0] ?? "other");
    const [notify, setNotify] = useState(true);
    const [issued, setIssued] = useState<string | null>(null);
    const { busy, error, setError, run } = useAsyncAction();
    const keyRef = useRef<Attempt | null>(null);

    const typed = parseCents(amount, BUSINESS_CURRENCY);
    const leftCents = summary.leftCents;
    const cents = mode === "full" ? leftCents : (typed ?? 0);
    const valid = cents > 0 && cents <= leftCents;
    const query = mode === "part" && valid ? `?amount_cents=${String(cents)}` : "";
    const preview = useRemote(
        () => api.get<RefundPreview>(`/v1/payments/${p.id}/refund-preview${query}`),
        `${p.id}${query}${String(p.refunded_cents)}`,
    );
    const data = preview.data;
    const blocked = data?.blocked == null ? null : (s.blocked[data.blocked] ?? null);
    const wholeOnly = data?.whole_only === true;
    const backTo = s.backTo(summary.method);
    const lines: DocTotalLine[] =
        data === null || !valid
            ? []
            : [
                  ...data.parts.map((part): DocTotalLine => ({
                      key: `${part.category}:${part.code}`,
                      label: partLabel(part),
                      cents: part.cents,
                      kind: part.category === "tax" ? "tax" : "subtotal",
                  })),
                  { key: "total", label: backTo, cents, kind: "total" },
              ];
    const nextNote = data?.next_credit_note ?? "";
    const mine = refunds.filter((r) => r.parent_payment_id === p.id);

    const setMode = (m: RefundMode): void => {
        keyRef.current = null;
        setError(null);
        setModeState(m);
    };

    const submit = (): void => {
        if (!valid || blocked !== null) {
            setError(s.errAmount(formatMoney(leftCents, BUSINESS_CURRENCY)));
            return;
        }
        const body = { amount_cents: cents, reason, notify };
        const key = attemptKey(keyRef, [p.id, body]);
        run(
            async () => {
                const out = await api.post<RefundResult>(`/v1/payments/${p.id}/refund`, body, {
                    idempotencyKey: key,
                });
                keyRef.current = null;
                if (out.status === "failed" || out.status === "canceled") {
                    setError(s.refundFailed);
                    return;
                }
                setAmountState("");
                setModeState("full");
                setIssued(
                    out.status === "succeeded"
                        ? s.refundedDone(
                              formatMoney(cents, BUSINESS_CURRENCY),
                              out.credit_note ?? nextNote,
                          )
                        : s.refundPending,
                );
            },
            { errorMessage: refundFailure },
        );
    };

    return {
        preview,
        blocked,
        wholeOnly,
        byHand: data?.by_hand ?? false,
        leftCents,
        mode,
        setMode,
        modes: [
            { key: "full", label: s.full(formatMoney(leftCents, BUSINESS_CURRENCY)) },
            { key: "part", label: s.part, disabled: wholeOnly },
        ],
        amount,
        setAmount: (v) => {
            keyRef.current = null;
            setAmountState(v);
        },
        amountPlaceholder: s.amountPlaceholder(formatMoney(leftCents, BUSINESS_CURRENCY)),
        reason,
        setReason,
        reasons: REFUND_REASONS.map((k) => ({ key: k, label: s.reasons[k] ?? k })),
        notify,
        setNotify,
        cents,
        valid,
        lines,
        feeNote:
            data === null || data.by_hand
                ? null
                : s.feeKept(formatMoney(data.fee_cents, BUSINESS_CURRENCY)),
        nextNote,
        submitLabel: s.refundButton(formatMoney(valid ? cents : leftCents, BUSINESS_CURRENCY)),
        confirmTitle: s.confirmTitle(formatMoney(cents, BUSINESS_CURRENCY)),
        confirmBody: s.confirmBody(nextNote),
        busy,
        error,
        submit,
        issued,
        history: [
            {
                key: p.id,
                label: formatParts([
                    s.paymentEvent,
                    formatMoney(p.amount_cents, BUSINESS_CURRENCY),
                ]),
                detail: summary.method,
                at: summary.when,
                intent: "success",
            },
            ...mine.map((r): TimelineEntry => ({
                key: r.id,
                label: formatParts([
                    s.refundEvent(r.credit_note ?? ""),
                    formatCredit(r.amount_cents, BUSINESS_CURRENCY),
                ]),
                detail: s.reasons[r.reason ?? ""] ?? s.noReason,
                at: formatDate(parseTimestamp(r.paid_at ?? r.created_at), zone),
                intent: "neutral",
            })),
        ],
    };
}

interface CreditNoteView {
    id: string;
    number: string;
    client: string;
    subject: string;
    when: string;
    reason: string;
    cents: number;
}

/** Every refund as its numbered credit note, newest first, with what was refunded this month. */
export function useCreditNotes(refunds: readonly RefundRow[]): {
    rows: CreditNoteView[];
    summary: string;
} {
    const zone = useBusinessZone();
    return useMemo(() => {
        const rows = refunds
            .filter((r) => r.status === "succeeded")
            .map((r) => ({
                id: r.id,
                number: r.credit_note ?? "",
                client: r.client_name ?? "",
                subject: paymentSubject(r),
                when: formatDate(parseTimestamp(r.paid_at ?? r.created_at), zone),
                reason: s.reasons[r.reason ?? ""] ?? s.noReason,
                cents: r.amount_cents,
            }));
        const monthStart = startOfMonth(new Date(), zone).getTime();
        const month = refunds
            .filter(
                (r) =>
                    r.status === "succeeded" &&
                    parseTimestamp(r.paid_at ?? r.created_at).getTime() >= monthStart,
            )
            .reduce((sum, r) => sum + r.amount_cents, 0);
        return {
            rows,
            summary: s.notesSummary(rows.length, formatMoney(month, BUSINESS_CURRENCY)),
        };
    }, [refunds, zone]);
}

interface DisputeRow {
    id: string;
    client_name: string | null;
    method: string;
    amount_cents: number;
    paid_at: string | null;
    created_at: string;
    dispute_status: string;
    dispute_reason: string | null;
    dispute_respond_by: string | null;
    invoice_number: number | null;
    order_number: number | null;
    gift_code: string | null;
    package_name: string | null;
    booking_id: string | null;
    withdrawn_cents: number;
    fee_cents: number;
    opened_at: string | null;
}

export const DISPUTES_SQL = `
SELECT p.id, c.name AS client_name, p.method, p.amount_cents, p.paid_at, p.created_at,
       p.dispute_status, p.dispute_reason, p.dispute_respond_by, i.number AS invoice_number,
       o.number AS order_number, g.code AS gift_code, pi.name AS package_name, p.booking_id,
       COALESCE((SELECT -SUM(de.amount_cents) FROM entries de
                 JOIN accounts da ON da.id = de.account_id
                 WHERE de.event = 'dispute' AND de.source_id = p.id
                   AND da.category = 'stripe'), 0) AS withdrawn_cents,
       COALESCE((SELECT SUM(fe.amount_cents) FROM entries fe
                 JOIN accounts fa ON fa.id = fe.account_id
                 WHERE fe.ref LIKE 'dispute_fee:%' AND fe.source_id = p.id
                   AND fa.category = 'processing_fee'), 0) AS fee_cents,
       (SELECT MIN(oe.occurred_at) FROM entries oe
        WHERE oe.event = 'dispute' AND oe.source_id = p.id) AS opened_at
FROM payments p
LEFT JOIN clients c ON c.id = p.client_id
LEFT JOIN invoices i ON i.id = p.invoice_id
LEFT JOIN orders o ON o.id = p.order_id
LEFT JOIN gift_cards g ON g.payment_id = p.id
LEFT JOIN packages pk ON pk.payment_id = p.id
LEFT JOIN items pi ON pi.id = pk.item_id
WHERE p.dispute_status IS NOT NULL
ORDER BY p.dispute_respond_by DESC`;

function disputeIntent(status: string): Intent {
    switch (status) {
        case "needs_response":
            return "danger";
        case "under_review":
            return "warning";
        case "won":
            return "success";
        default:
            return "neutral";
    }
}

interface DisputeView {
    row: DisputeRow;
    open: boolean;
    subject: string;
    statusLabel: string;
    intent: Intent;
    deadline: string;
    reason: string;
    facts: { label: string; value: string }[];
    held: DocTotalLine[];
}

export function disputeView(d: DisputeRow, now: Date, zone: string): DisputeView {
    const open = d.dispute_status === "needs_response" || d.dispute_status === "under_review";
    const reason = s.disputeReasons[d.dispute_reason ?? "general"] ?? d.dispute_reason ?? "";
    const subject = paymentSubject(d);
    const deadline =
        d.dispute_status === "needs_response" && d.dispute_respond_by !== null
            ? s.respondBy(
                  formatDate(parseTimestamp(d.dispute_respond_by), zone),
                  Math.max(0, daysUntil(parseTimestamp(d.dispute_respond_by), zone, now)),
              )
            : d.dispute_status === "won"
              ? s.wonNote
              : d.dispute_status === "lost"
                ? s.lostNote
                : s.reviewNote;
    const withdrawn = d.withdrawn_cents > 0 ? d.withdrawn_cents : d.amount_cents;
    return {
        row: d,
        open,
        subject,
        statusLabel: s.disputeStatus[d.dispute_status] ?? d.dispute_status,
        intent: disputeIntent(d.dispute_status),
        deadline,
        reason,
        facts: [
            { label: s.reasonLabel, value: reason },
            {
                label: s.payment,
                value: formatParts([
                    methodLabel(d.method),
                    formatMoney(d.amount_cents, BUSINESS_CURRENCY),
                ]),
            },
            { label: s.forLabel, value: subject },
            {
                label: s.opened,
                value: d.opened_at === null ? "" : formatDate(parseTimestamp(d.opened_at), zone),
            },
        ],
        held: [
            { key: "withdrawn", label: s.withdrawn, cents: withdrawn, kind: "subtotal" },
            {
                key: "fee",
                label: s.disputeFee,
                cents: d.fee_cents,
                kind: "subtotal",
                hint: s.returnedIfWon,
            },
            { key: "held", label: s.held, cents: withdrawn + d.fee_cents, kind: "total" },
        ],
    };
}

export interface DisputeDesk {
    load: Load;
    open: DisputeView[];
    closed: DisputeView[];
    summary: string;
    selectedId: string | null;
    select: (id: string | null) => void;
    selected: DisputeView | null;
}

/** Card disputes mirrored from Stripe: open first, with the bank's deadline and what is held. */
export function useDisputes(): DisputeDesk {
    const query = useQuery<DisputeRow>(DISPUTES_SQL);
    const load = useReplicaLoad([query], query.data.length === 0);
    const [selectedId, select] = useState<string | null>(null);
    const zone = useBusinessZone();
    const all = useMemo(() => {
        const now = new Date();
        return query.data.map((d) => disputeView(d, now, zone));
    }, [query.data, zone]);
    const open = all.filter((d) => d.open);
    return {
        load,
        open,
        closed: all.filter((d) => !d.open),
        summary: s.disputesSummary(open.length),
        selectedId,
        select,
        selected: all.find((d) => d.row.id === selectedId) ?? null,
    };
}
