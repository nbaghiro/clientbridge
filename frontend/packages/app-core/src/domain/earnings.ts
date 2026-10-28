import { useBusinessQuery as useQuery } from "../hooks";

import { useMemo, useRef, useState } from "react";

import { type Load, useAsyncAction } from "../hooks";
import { type ApiLike, type Attempt, attemptKey, failureMessage, sendAttempt } from "../api";
import { formatMoney, formatParts, formatRate, parseCents, BUSINESS_CURRENCY } from "../format";
import {
    dateKey,
    formatShortDay,
    parseDateKey,
    parseTimestamp,
    useBusinessZone,
    yearOf,
} from "../datetime";
import type { Intent } from "../ui";
import { strings } from "../strings";
import { staffName, staffNameSql } from "./staff";
import { afterReview } from "./previews";
import { addressLines, type PostalParts } from "./printing";
import { useReplicaLoad } from "./sync";

interface EarningRow {
    id: string;
    staff_id: string;
    kind: "earning" | "tip";
    basis: string | null;
    rate: number | null;
    base: number | null;
    amount_cents: number;
    status: string;
    worked_at: string;
    paid_at: string | null;
    run: string | null;
    through: string | null;
    label: string | null;
    number: number | null;
    client_name: string | null;
    of_id: string | null;
}

// Context is in meta (a member's replica has no documents); joins are grouped, never per row.
const EARNINGS_SQL = `
SELECT * FROM (
    SELECT e.journal_id AS id, e.owner_id AS staff_id, e.event AS kind,
           -e.amount_cents AS amount_cents,
           COALESCE(json_extract(e.meta, '$.worked_at'), e.occurred_at) AS worked_at,
           json_extract(e.meta, '$.basis') AS basis,
           json_extract(e.meta, '$.rate') AS rate,
           json_extract(e.meta, '$.base') AS base,
           json_extract(e.meta, '$.number') AS number,
           json_extract(e.meta, '$.of') AS of_id,
           COALESCE(json_extract(e.meta, '$.label'), json_extract(og.meta, '$.label'),
                    json_extract(e.meta, '$.reason')) AS label,
           c.name AS client_name,
           CASE WHEN st.paid > 0 THEN st.paid_at END AS paid_at,
           CASE WHEN st.paid > 0 THEN json_extract(pay.meta, '$.run') END AS run,
           CASE WHEN st.paid > 0 THEN json_extract(pay.meta, '$.through') END AS through,
           CASE
               WHEN st.reversed = 1 THEN 'reversed'
               WHEN st.paid > 0 THEN 'paid'
               WHEN st.approved > 0 THEN 'approved'
               ELSE 'pending'
           END AS status
    FROM entries e
    LEFT JOIN (
        SELECT x.source_id,
               COUNT(DISTINCT CASE WHEN x.event = 'approval' AND x.ref NOT LIKE '%:undo' THEN x.journal_id END)
                   - COUNT(DISTINCT CASE WHEN x.event = 'approval' AND x.ref LIKE '%:undo' THEN x.journal_id END)
                   AS approved,
               COUNT(DISTINCT CASE WHEN x.event = 'staff_payment' AND x.ref NOT LIKE '%:undo' THEN x.journal_id END)
                   - COUNT(DISTINCT CASE WHEN x.event = 'staff_payment' AND x.ref LIKE '%:undo' THEN x.journal_id END)
                   AS paid,
               MAX(CASE WHEN x.event = 'reversal' AND x.ref = 'earning:' || x.source_id || ':reversal' THEN 1 ELSE 0 END)
                   AS reversed,
               MAX(CASE WHEN x.event = 'staff_payment' AND x.ref NOT LIKE '%:undo' THEN x.occurred_at END) AS paid_at
        FROM entries x
        WHERE x.source_type = 'journal' AND x.event IN ('approval', 'staff_payment', 'reversal')
        GROUP BY x.source_id
    ) st ON st.source_id = e.journal_id
    LEFT JOIN (
        SELECT source_id, occurred_at, MAX(meta) AS meta FROM entries
        WHERE source_type = 'journal' AND event = 'staff_payment' AND owner_type = 'staff'
            AND ref NOT LIKE '%:undo'
        GROUP BY source_id, occurred_at
    ) pay ON pay.source_id = e.journal_id AND pay.occurred_at = st.paid_at
    LEFT JOIN (
        SELECT journal_id, MAX(meta) AS meta FROM entries
        WHERE owner_type = 'staff' AND event = 'earning'
        GROUP BY journal_id
    ) og ON og.journal_id = json_extract(e.meta, '$.of')
    LEFT JOIN clients c ON c.id = COALESCE(json_extract(e.meta, '$.client_id'), json_extract(og.meta, '$.client_id'))
    WHERE e.event IN ('earning', 'tip') AND e.owner_type = 'staff' AND e.amount_cents != 0
)`;

export const ALL_EARNINGS_SQL = `${EARNINGS_SQL}
ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, worked_at DESC`;

const isOpen = (r: EarningRow): boolean => r.status === "pending" || r.status === "approved";

const sum = (rows: readonly { amount_cents: number }[]): number =>
    rows.reduce((n, r) => n + r.amount_cents, 0);

/** What a member is still owed, or owes back, as a note for the remove dialog; null when even. */
export function useOwedPay(staffId: string): string | null {
    const net = sum(useEarnings().filter((r) => r.staff_id === staffId && isOpen(r)));
    if (net === 0) return null;
    return net > 0
        ? strings.earnings.owedOnRemove(formatMoney(net, BUSINESS_CURRENCY))
        : strings.earnings.owesBackOnRemove(formatMoney(-net, BUSINESS_CURRENCY));
}

/** Every staff earning and tip, pending → approved → paid (reversed ones sort last). */
export function useEarnings(): EarningRow[] {
    return useQuery<EarningRow>(ALL_EARNINGS_SQL).data;
}

export const PAYEES_SQL = `
SELECT s.id, ${staffNameSql("s")} AS name, s.title, s.role, s.color, s.status, s.payee, s.rate_type, s.rate_bps,
       s.rate_cents, s.retail_rate_bps
FROM staff s WHERE s.status != 'invited'
  AND ((s.status = 'active' AND s.payee = 1) OR EXISTS (SELECT 1 FROM entries e WHERE e.owner_type = 'staff'
                              AND e.owner_id = s.id AND e.event IN ('earning', 'tip')))
ORDER BY COALESCE(${staffNameSql("s")}, s.title, s.role) COLLATE NOCASE`;

interface PayeeRow {
    id: string;
    name: string | null;
    title: string | null;
    role: string;
    color: string | null;
    status: string;
    rate_type: string | null;
    rate_bps: number | null;
    rate_cents: number | null;
    retail_rate_bps: number | null;
}

export function earningStageIntent(status: string): Intent {
    switch (status) {
        case "approved":
            return "accent";
        case "paid":
            return "success";
        case "reversed":
            return "neutral";
        default:
            return "warning";
    }
}

export type EarningsView = "todo" | "paid" | "all";

export const EARNINGS_VIEWS: readonly EarningsView[] = ["todo", "paid", "all"];

type Undo = "unapprove" | "unpay";

interface EarningLine {
    id: string;
    at: Date;
    title: string;
    detail: string;
    status: string;
    amountCents: number;
    tip: boolean;
    // a pending or approved row can be picked to approve or pay
    pickable: boolean;
    undo: Undo | null;
    // the accessible name of the row's checkbox and undo button
    label: string;
}

function lineSource(row: EarningRow): string {
    const e = strings.earnings;
    if (row.basis === "clawback") return e.sourceRefund;
    if (row.kind === "tip") return e.sourceTip;
    if (row.basis === "adjustment") return e.sourceAdjustment;
    if (row.basis === "retail" && row.number !== null) return e.sourceSale;
    return e.sourceWork;
}

function lineTitle(row: EarningRow): string {
    const e = strings.earnings;
    if (row.basis === "clawback")
        return row.label !== null ? e.refundOf(row.label) : e.sourceRefund;
    if (row.kind === "tip") return row.amount_cents < 0 ? e.tipRefunded : e.tipTitle;
    if (row.label !== null) return row.label;
    return row.number !== null ? e.saleTitle(row.number) : e.sourceWork;
}

function lineShare(row: EarningRow): string | null {
    const e = strings.earnings;
    if (row.kind === "tip" || row.basis === "clawback" || row.basis === "adjustment") return null;
    if ((row.basis === "percent" || row.basis === "retail") && row.rate !== null) {
        return row.base !== null
            ? e.lineOf(formatRate(row.rate), formatMoney(row.base, BUSINESS_CURRENCY))
            : formatRate(row.rate);
    }
    if (row.basis === "fixed") return e.fixed;
    if (row.basis === "rate") return e.hourly;
    return null;
}

function earningLine(row: EarningRow, zone: string, editable: boolean): EarningLine {
    const at = parseTimestamp(row.worked_at);
    const title = lineTitle(row);
    const amount = formatMoney(row.amount_cents, BUSINESS_CURRENCY);
    const undo: Undo | null = !editable
        ? null
        : row.status === "approved"
          ? "unapprove"
          : row.status === "paid"
            ? "unpay"
            : null;
    return {
        id: row.id,
        at,
        title,
        detail: formatParts([lineSource(row), row.client_name, lineShare(row)]),
        status: row.status,
        amountCents: row.amount_cents,
        tip: row.kind === "tip",
        pickable: editable && isOpen(row),
        undo,
        label: formatParts([title, formatShortDay(at, zone), amount]),
    };
}

interface PayeeView {
    staffId: string;
    name: string;
    title: string | null;
    color: string | null;
    rates: string;
    pendingCents: number;
    pendingCount: number;
    approvedCents: number;
    paidYtdCents: number;
    // refunds and deductions beyond what they're owed; 0 when they owe nothing
    owesBackCents: number;
    figures: string;
}

interface StatementPart {
    label: string;
    cents: number;
}

interface PaidGroup {
    key: string;
    run: string | null;
    // the pay day as YYYY-MM-DD and formatted, in the business zone
    payDay: string;
    day: string;
    label: string;
    through: string | null;
    totalCents: number;
    parts: StatementPart[];
    lines: EarningLine[];
    ids: string[];
}

function statementParts(rows: readonly EarningRow[]): StatementPart[] {
    const e = strings.earnings.part;
    const buckets: [string, (r: EarningRow) => boolean][] = [
        [e.work, (r) => r.kind === "earning" && r.basis !== "adjustment" && r.basis !== "clawback"],
        [e.tips, (r) => r.kind === "tip"],
        [e.adjustments, (r) => r.basis === "adjustment"],
        [e.refunds, (r) => r.basis === "clawback"],
    ];
    return buckets
        .map(([label, test]) => ({ label, cents: sum(rows.filter(test)) }))
        .filter((p) => p.cents !== 0);
}

function paidGroups(rows: readonly EarningRow[], zone: string, editable: boolean): PaidGroup[] {
    const groups = new Map<string, EarningRow[]>();
    for (const r of rows) {
        if (r.status !== "paid" || r.paid_at === null) continue;
        const k = r.run ?? dateKey(parseTimestamp(r.paid_at), zone);
        groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    return [...groups.entries()]
        .map(([k, rows]) => {
            const first = rows[0];
            const paidAt = parseTimestamp(first?.paid_at ?? "");
            const through = first?.through ?? null;
            const throughDay = through === null ? null : parseDateKey(through, zone);
            const day = formatShortDay(paidAt, zone);
            const group: PaidGroup = {
                key: k,
                run: first?.run ?? null,
                payDay: dateKey(paidAt, zone),
                day,
                label: strings.earnings.paidOn(day),
                through:
                    throughDay === null
                        ? null
                        : strings.earnings.workThrough(formatShortDay(throughDay, zone)),
                totalCents: sum(rows),
                parts: statementParts(rows),
                lines: rows.map((r) => earningLine(r, zone, editable)),
                ids: rows.map((r) => r.id),
            };
            return { at: paidAt.getTime(), group };
        })
        .sort((a, b) => b.at - a.at)
        .map(({ group }) => group);
}

const STATEMENT_HEADER_SQL = `
SELECT name, unit, street_number, street_name, city, province, postal_code FROM businesses LIMIT 1`;

interface StatementHeader {
    business: string;
    address: string[];
}

/** Who a pay statement is from: the business name and its address as printed on invoices. */
export function useStatementHeader(): StatementHeader {
    const row = useQuery<PostalParts & { name: string | null }>(STATEMENT_HEADER_SQL).data[0];
    return { business: row?.name ?? "", address: row === undefined ? [] : addressLines(row) };
}

/** A pay statement as plain text, for sharing where printing isn't available. */
export function statementText(header: StatementHeader, name: string, group: PaidGroup): string {
    const e = strings.earnings;
    const money = (cents: number): string => formatMoney(cents, BUSINESS_CURRENCY);
    return [
        header.business,
        ...header.address,
        e.statementTitle,
        e.statementFor(name, group.day),
        ...(group.through === null ? [] : [group.through]),
        "",
        ...group.lines.map((l) => formatParts([l.title, l.detail, money(l.amountCents)])),
        "",
        ...group.parts.map((p) => formatParts([p.label, money(p.cents)])),
        formatParts([e.total, money(group.totalCents)]),
    ].join("\n");
}

export function statementFile(group: PaidGroup): string {
    return `pay-statement-${group.key}.txt`;
}

interface Range {
    from: string | null;
    to: string | null;
}

interface EarningApprovals {
    load: Load;
    payees: PayeeView[];
    selected: PayeeView | null;
    select: (staffId: string) => void;
    // false for an admin looking at their own pay, which only the owner moves
    editable: boolean;
    view: EarningsView;
    setView: (view: EarningsView) => void;
    // a YYYY-MM-DD day in the business zone; work done after it waits for the next pay
    through: string | null;
    setThrough: (day: string | null) => void;
    range: Range;
    setRange: (range: Range) => void;
    showReversed: boolean;
    setShowReversed: (show: boolean) => void;
    lines: EarningLine[];
    emptyMessage: string;
    paidGroups: PaidGroup[];
    picked: string[];
    togglePick: (id: string) => void;
    pickAll: () => void;
    allPicked: boolean;
    canPick: boolean;
    totals: { pendingCents: number; approvedCents: number; paidYtdCents: number };
    summary: string;
    busy: "approve" | "pay" | "undo" | null;
    error: string | null;
    approveLabel: string;
    canApprove: boolean;
    approvePicked: () => void;
    payLabel: string;
    canPay: boolean;
    pay: () => void;
    undo: (line: EarningLine) => void;
    undoRun: (group: PaidGroup) => void;
    runCsvPath: (group: PaidGroup) => string;
}

function rates(p: PayeeRow): string {
    const e = strings.earnings;
    const service =
        p.rate_type === "percent" && p.rate_bps !== null
            ? e.serviceRate(formatRate(p.rate_bps))
            : p.rate_type === "fixed" && p.rate_cents !== null
              ? e.fixedRate(formatMoney(p.rate_cents, BUSINESS_CURRENCY))
              : p.rate_type === "hourly" && p.rate_cents !== null
                ? e.hourlyRate(formatMoney(p.rate_cents, BUSINESS_CURRENCY))
                : null;
    const retail = p.retail_rate_bps ? e.retailRate(formatRate(p.retail_rate_bps)) : null;
    return formatParts([service, retail]);
}

/** The refund corrections a pay settles with the rows it pays, as the server picks them. */
function travelling(mine: readonly EarningRow[], paying: readonly EarningRow[]): EarningRow[] {
    const ids = new Set(paying.map((r) => r.id));
    const status = new Map(mine.map((r) => [r.id, r.status]));
    return mine.filter((r) => {
        if (ids.has(r.id) || !isOpen(r)) return false;
        if (r.basis !== "clawback" && !(r.kind === "tip" && r.amount_cents < 0)) return false;
        const of = r.of_id === null ? undefined : status.get(r.of_id);
        return r.of_id === null || ids.has(r.of_id) || of === "paid" || of === "reversed";
    });
}

interface Viewer {
    staffId: string | null;
    owner: boolean;
}

/** Staff pay: each payee's earnings, tips and adjustments, approved, paid and undone if need be. */
export function useEarningApprovals(api: ApiLike, viewer: Viewer): EarningApprovals {
    const earnings = useQuery<EarningRow>(ALL_EARNINGS_SQL);
    const staff = useQuery<PayeeRow>(PAYEES_SQL);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [picked, setPicked] = useState<string[]>([]);
    const [view, setViewState] = useState<EarningsView>("todo");
    const [through, setThroughState] = useState<string | null>(null);
    const [range, setRangeState] = useState<Range>({ from: null, to: null });
    const [showReversed, setShowReversed] = useState(false);
    const [action, setAction] = useState<"approve" | "pay" | "undo">("approve");
    const key = useRef<Attempt | null>(null);
    const { busy, error, run } = useAsyncAction();
    const zone = useBusinessZone();
    const year = yearOf(new Date(), zone);
    const day = (at: string): string => dateKey(parseTimestamp(at), zone);
    const e = strings.earnings;
    const payees = useMemo(
        () =>
            staff.data.flatMap((p) => {
                const copy = strings.earnings;
                const mine = earnings.data.filter((r) => r.staff_id === p.id);
                const pending = mine.filter((r) => r.status === "pending");
                const approvedCents = sum(mine.filter((r) => r.status === "approved"));
                const paidYtdCents = sum(
                    mine.filter(
                        (r) =>
                            r.status === "paid" &&
                            r.paid_at !== null &&
                            yearOf(parseTimestamp(r.paid_at), zone) === year,
                    ),
                );
                const removed = p.status === "removed";
                if (removed && !mine.some(isOpen) && paidYtdCents === 0) return [];
                const net = sum(mine.filter(isOpen));
                return {
                    staffId: p.id,
                    name: staffName({ name: p.name, title: p.title, role: p.role }),
                    title: removed ? copy.removedMember : p.title,
                    color: p.color,
                    rates: rates(p),
                    pendingCents: sum(pending),
                    pendingCount: pending.length,
                    approvedCents,
                    paidYtdCents,
                    owesBackCents: net < 0 ? -net : 0,
                    figures: copy.payeeFigures(
                        formatMoney(sum(pending), BUSINESS_CURRENCY),
                        formatMoney(approvedCents, BUSINESS_CURRENCY),
                    ),
                };
            }),
        [staff.data, earnings.data, year, zone],
    );
    const selected =
        selectedId === null
            ? (payees[0] ?? null)
            : (payees.find((p) => p.staffId === selectedId) ?? null);
    const editable = selected !== null && (viewer.owner || selected.staffId !== viewer.staffId);
    const mine = useMemo(
        () => earnings.data.filter((r) => r.staff_id === selected?.staffId),
        [earnings.data, selected?.staffId],
    );
    const due = mine.filter(isOpen).filter((r) => through === null || day(r.worked_at) <= through);
    const inRange = (at: string): boolean => {
        const d = day(at);
        return (range.from === null || d >= range.from) && (range.to === null || d <= range.to);
    };
    const rows =
        view === "all"
            ? mine.filter((r) => (showReversed || r.status !== "reversed") && inRange(r.worked_at))
            : due;
    const dueIds = new Set(due.map((r) => r.id));
    const shown = editable ? picked.filter((id) => dueIds.has(id)) : [];
    const pickedRows = due.filter((r) => shown.includes(r.id));
    const toApprove = pickedRows.filter((r) => r.status === "pending");
    const paying =
        pickedRows.length > 0
            ? pickedRows
            : through !== null
              ? due
              : due.filter((r) => r.status === "approved");
    const payTotal = sum([...paying, ...travelling(mine, paying)]);
    const settles = paying.length > 0 && payTotal === 0;
    const groups = useMemo(
        () =>
            paidGroups(mine, zone, editable).filter(
                (g) =>
                    (range.from === null || g.payDay >= range.from) &&
                    (range.to === null || g.payDay <= range.to),
            ),
        [mine, zone, editable, range.from, range.to],
    );
    const load = useReplicaLoad([earnings, staff], payees.length === 0);
    const reset = (): void => {
        key.current = null;
        setPicked([]);
    };
    const advance = (
        path: string,
        body: { ids: string[]; through?: string },
        kind: "approve" | "pay" | "undo",
    ): void => {
        const idempotencyKey = attemptKey(key, [path, body]);
        setAction(kind);
        run(() => api.post(`/v1/earnings/${path}`, body, { idempotencyKey }), {
            onSuccess: reset,
            errorMessage: (err) => failureMessage(err, e.updateError),
        });
    };
    const r = e.review;
    const name = selected?.name ?? "";
    return {
        load,
        payees,
        summary: e.summary(payees.length, payees.filter((p) => p.pendingCount > 0).length),
        selected,
        select: (id) => {
            reset();
            setSelectedId(id);
        },
        editable,
        view,
        setView: (v) => {
            reset();
            if (v !== "todo") setThroughState(null);
            setViewState(v);
        },
        through,
        setThrough: (d) => {
            reset();
            setThroughState(d);
        },
        range,
        setRange: setRangeState,
        showReversed,
        setShowReversed,
        lines: rows.map((row) => earningLine(row, zone, editable)),
        emptyMessage:
            view === "todo" && through !== null && mine.some(isOpen) ? e.noneThrough : e.noEarnings,
        paidGroups: groups,
        picked: shown,
        togglePick: (id) => {
            key.current = null;
            setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
        },
        pickAll: () => {
            key.current = null;
            setPicked(shown.length === due.length ? [] : due.map((x) => x.id));
        },
        allPicked: due.length > 0 && shown.length === due.length,
        canPick: editable && due.length > 0,
        totals: {
            pendingCents: payees.reduce((n, p) => n + p.pendingCents, 0),
            approvedCents: payees.reduce((n, p) => n + p.approvedCents, 0),
            paidYtdCents: payees.reduce((n, p) => n + p.paidYtdCents, 0),
        },
        busy: busy ? action : null,
        error,
        approveLabel:
            busy && action === "approve" ? e.working : e.approveSelected(toApprove.length),
        canApprove: editable && !busy && toApprove.length > 0,
        approvePicked: () => {
            if (toApprove.length === 0) return;
            advance("approve", { ids: toApprove.map((x) => x.id) }, "approve");
        },
        payLabel: settles ? e.settle : e.payApproved(formatMoney(payTotal, BUSINESS_CURRENCY)),
        canPay: editable && !busy && paying.length > 0 && payTotal >= 0,
        pay: () => {
            if (paying.length === 0 || payTotal < 0) return;
            const ids = paying.map((x) => x.id);
            afterReview(
                settles
                    ? { title: r.settleTitle(name), message: r.settleBody, confirmLabel: e.settle }
                    : {
                          title: r.payTitle(formatMoney(payTotal, BUSINESS_CURRENCY), name),
                          message: r.payBody,
                          confirmLabel: r.markPaid,
                      },
                () => {
                    advance("pay", through === null ? { ids } : { ids, through }, "pay");
                },
            );
        },
        undo: (line) => {
            const path = line.undo;
            if (path === null) return;
            afterReview(
                {
                    title: path === "unpay" ? r.undoPaymentTitle : r.undoApprovalTitle,
                    message: path === "unpay" ? r.undoPaymentBody : r.undoApprovalBody,
                    confirmLabel: r.undo,
                },
                () => {
                    advance(path, { ids: [line.id] }, "undo");
                },
            );
        },
        undoRun: (group) => {
            if (!editable) return;
            afterReview(
                {
                    title:
                        group.totalCents === 0
                            ? r.undoSettleTitle(name)
                            : r.undoRunTitle(
                                  formatMoney(group.totalCents, BUSINESS_CURRENCY),
                                  name,
                              ),
                    message: r.undoPaymentBody,
                    confirmLabel: r.undo,
                },
                () => {
                    advance("unpay", { ids: group.ids }, "undo");
                },
            );
        },
        runCsvPath: (group) => {
            const runParam = group.run === null ? "" : `&run=${encodeURIComponent(group.run)}`;
            return `/v1/reports/staff-pay.csv?start=${group.payDay}&end=${group.payDay}${runParam}`;
        },
    };
}

interface AdjustmentForm {
    kind: "bonus" | "deduction";
    setKind: (kind: "bonus" | "deduction") => void;
    amount: string;
    setAmount: (v: string) => void;
    reason: string;
    setReason: (v: string) => void;
    error: string | null;
    busy: boolean;
    submit: () => void;
}

/** A bonus or deduction for one member; it then waits for approval like any earning. */
export function useAdjustmentForm(
    api: ApiLike,
    staffId: string,
    onDone: () => void,
): AdjustmentForm {
    const a = strings.earnings.adjustment;
    const [kind, setKind] = useState<"bonus" | "deduction">("bonus");
    const [amount, setAmount] = useState("");
    const [reason, setReason] = useState("");
    const [invalid, setInvalid] = useState<string | null>(null);
    const attempt = useRef<Attempt | null>(null);
    const { busy, error, run } = useAsyncAction();
    return {
        kind,
        setKind,
        amount,
        setAmount,
        reason,
        setReason,
        error: invalid ?? error,
        busy,
        submit: () => {
            const cents = parseCents(amount, BUSINESS_CURRENCY);
            if (cents === null || cents <= 0) {
                setInvalid(a.amountInvalid);
                return;
            }
            if (reason.trim() === "") {
                setInvalid(a.reasonMissing);
                return;
            }
            setInvalid(null);
            const body = {
                staff_id: staffId,
                amount_cents: kind === "bonus" ? cents : -cents,
                reason: reason.trim(),
            };
            run(
                () =>
                    sendAttempt(attempt, ["/v1/earnings/adjustments", body], (idempotencyKey) =>
                        api.post("/v1/earnings/adjustments", body, { idempotencyKey }),
                    ),
                { onSuccess: onDone, errorMessage: (err) => failureMessage(err, a.error) },
            );
        },
    };
}

interface MyEarnings {
    load: Load;
    name: string;
    pendingCents: number;
    approvedCents: number;
    paidYtdCents: number;
    lines: EarningLine[];
    paidGroups: PaidGroup[];
    view: "todo" | "paid";
    setView: (view: "todo" | "paid") => void;
}

/** A member's own pay, read-only: what waits for approval, what's approved and what's been paid. */
export function useMyEarnings(staffId: string | null): MyEarnings {
    const earnings = useQuery<EarningRow>(ALL_EARNINGS_SQL);
    const me = useQuery<{ name: string | null; title: string | null; role: string }>(
        `SELECT ${staffNameSql("s")} AS name, s.title, s.role FROM staff s WHERE s.id = ?`,
        [staffId],
    ).data[0];
    const [view, setView] = useState<"todo" | "paid">("todo");
    const zone = useBusinessZone();
    const year = yearOf(new Date(), zone);
    const mine = useMemo(
        () => earnings.data.filter((r) => r.staff_id === staffId && r.status !== "reversed"),
        [earnings.data, staffId],
    );
    const groups = useMemo(() => paidGroups(mine, zone, false), [mine, zone]);
    return {
        load: useReplicaLoad([earnings], mine.length === 0),
        name: me === undefined ? "" : staffName(me),
        pendingCents: sum(mine.filter((r) => r.status === "pending")),
        approvedCents: sum(mine.filter((r) => r.status === "approved")),
        paidYtdCents: sum(
            mine.filter(
                (r) =>
                    r.status === "paid" &&
                    r.paid_at !== null &&
                    yearOf(parseTimestamp(r.paid_at), zone) === year,
            ),
        ),
        lines: mine.filter(isOpen).map((r) => earningLine(r, zone, false)),
        paidGroups: groups,
        view,
        setView,
    };
}

interface StaffPayFile {
    busy: boolean;
    error: string | null;
    done: string | null;
    // fetches a server CSV, such as a pay run's
    save: (path: string, filename: string) => void;
    // writes text made here, such as a statement
    saveText: (content: string, filename: string) => void;
}

/** Pay files; the platform `write` seam is a Blob download on web and Share on mobile. */
export function useStaffPayFile(
    api: ApiLike,
    write: (csv: string, filename: string) => void | Promise<void>,
): StaffPayFile {
    const { busy, error, run } = useAsyncAction();
    const [done, setDone] = useState<string | null>(null);
    return {
        busy,
        error,
        done,
        save: (path, filename) => {
            setDone(null);
            run(
                async () => {
                    await write(await api.getText(path), filename);
                },
                {
                    onSuccess: () => {
                        setDone(strings.reports.downloaded(filename));
                    },
                    errorMessage: (err) => failureMessage(err, strings.reports.downloadFailed),
                },
            );
        },
        saveText: (content, filename) => {
            setDone(null);
            run(
                async () => {
                    await write(content, filename);
                },
                { errorMessage: (err) => failureMessage(err, strings.reports.downloadFailed) },
            );
        },
    };
}

export function runCsvFile(group: PaidGroup): string {
    return `staff-pay-${group.payDay}.csv`;
}
