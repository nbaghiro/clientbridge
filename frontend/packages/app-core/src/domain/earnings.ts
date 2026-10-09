import { useBusinessQuery as useQuery } from "../hooks";

import { useMemo, useRef, useState } from "react";

import { type Load, useAsyncAction } from "../hooks";
import { type ApiLike, newIdempotencyKey } from "../api";
import { formatMoney } from "../format";
import { parseTimestamp } from "../datetime";
import type { Intent } from "../ui";
import { strings } from "../strings";
import { staffName } from "./staff";
import { useReplicaLoad } from "./sync";

interface EarningRow {
    id: string;
    staff_id: string;
    kind: "earning" | "tip";
    basis: string | null;
    rate: number | null;
    amount_cents: number;
    status: string;
    created_at: string;
    paid_at: string | null;
    line_description: string | null;
    line_cents: number | null;
    order_number: number | null;
    client_name: string | null;
}

// A stage is whether the approval, payment or reversal journal exists; tips go through the same stages.
const EARNINGS_SQL = `
SELECT * FROM (
    SELECT e.journal_id AS id, e.owner_id AS staff_id, e.event AS kind,
           -e.amount_cents AS amount_cents, e.occurred_at AS created_at,
           json_extract(e.meta, '$.basis') AS basis,
           COALESCE(json_extract(e.meta, '$.rate_bps'), json_extract(e.meta, '$.rate')) AS rate,
           l.description AS line_description, l.amount_cents AS line_cents,
           o.number AS order_number,
           COALESCE(ci.name, co.name, cp.name) AS client_name,
           (SELECT x.occurred_at FROM entries x WHERE x.ref = 'staff_payment:' || e.journal_id
            LIMIT 1) AS paid_at,
           CASE
               WHEN EXISTS (SELECT 1 FROM entries x WHERE x.ref = 'earning:' || e.journal_id || ':reversal')
                   THEN 'reversed'
               WHEN EXISTS (SELECT 1 FROM entries x WHERE x.ref = 'staff_payment:' || e.journal_id)
                   THEN 'paid'
               WHEN EXISTS (SELECT 1 FROM entries x WHERE x.ref = 'approval:' || e.journal_id)
                   THEN 'approved'
               ELSE 'pending'
           END AS status
    FROM entries e
    LEFT JOIN lines l ON e.source_type = 'line' AND l.id = e.source_id
    LEFT JOIN invoices i ON i.id = l.invoice_id
    LEFT JOIN orders o ON o.id = COALESCE(l.order_id, CASE WHEN e.subject_type = 'order' THEN e.subject_id END)
    LEFT JOIN payments p ON e.source_type = 'payment' AND p.id = e.source_id
    LEFT JOIN clients ci ON ci.id = i.client_id
    LEFT JOIN clients co ON co.id = o.client_id
    LEFT JOIN clients cp ON cp.id = p.client_id
    WHERE e.event IN ('earning', 'tip') AND e.owner_type = 'staff' AND e.amount_cents != 0
)`;

export const ALL_EARNINGS_SQL = `${EARNINGS_SQL}
ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, created_at DESC`;

/** Every staff earning and tip, pending → approved → paid (reversed ones sort last). */
export function useEarnings(): EarningRow[] {
    return useQuery<EarningRow>(ALL_EARNINGS_SQL).data;
}

export const PAYEES_SQL = `
SELECT s.id, s.name, s.title, s.role, s.color, s.payee, s.rate_type, s.rate_bps, s.rate_cents,
       s.retail_rate_bps
FROM staff s WHERE s.status = 'active'
  AND (s.payee = 1 OR EXISTS (SELECT 1 FROM entries e WHERE e.owner_type = 'staff'
                              AND e.owner_id = s.id AND e.event IN ('earning', 'tip')))
ORDER BY COALESCE(s.name, s.title, s.role) COLLATE NOCASE`;

interface PayeeRow {
    id: string;
    name: string | null;
    title: string | null;
    role: string;
    color: string | null;
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

const pct = (bps: number): string => `${String(bps / 100)}%`;

interface EarningLine {
    id: string;
    at: Date;
    title: string;
    detail: string;
    status: string;
    amountCents: number;
    tip: boolean;
}

function earningLine(row: EarningRow): EarningLine {
    const e = strings.earnings;
    const source =
        row.kind === "tip" ? e.sourceTip : row.basis === "retail" ? e.sourceSale : e.sourceBooking;
    const base =
        row.basis === "retail" && row.rate !== null && row.rate > 0
            ? Math.round((row.amount_cents * 10000) / row.rate)
            : row.line_cents;
    const share =
        row.kind === "tip"
            ? null
            : (row.basis === "percent" || row.basis === "retail") &&
                row.rate !== null &&
                base !== null
              ? e.lineOf(pct(row.rate), formatMoney(base))
              : row.basis === "fixed"
                ? e.fixed
                : row.basis === "rate"
                  ? e.hourly
                  : null;
    const title =
        row.kind === "tip"
            ? e.tipTitle
            : row.basis === "retail"
              ? row.order_number === null
                  ? e.sourceSale
                  : e.saleTitle(row.order_number)
              : (row.line_description ?? e.sourceBooking);
    return {
        id: row.id,
        at: parseTimestamp(row.created_at),
        title,
        detail: [source, row.client_name, share].filter((x) => x !== null && x !== "").join(" · "),
        status: row.status,
        amountCents: row.amount_cents,
        tip: row.kind === "tip",
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
    tipsCents: number;
}

interface EarningApprovals {
    load: Load;
    payees: PayeeView[];
    selected: PayeeView | null;
    select: (staffId: string) => void;
    lines: EarningLine[];
    picked: string[];
    togglePick: (id: string) => void;
    pickAllPending: () => void;
    totals: { pendingCents: number; approvedCents: number; paidYtdCents: number };
    busy: boolean;
    error: string | null;
    approvePicked: () => void;
    payApproved: () => void;
}

function rates(p: PayeeRow): string {
    const e = strings.earnings;
    const service =
        p.rate_type === "percent" && p.rate_bps !== null
            ? e.serviceRate(pct(p.rate_bps))
            : p.rate_type === "fixed" && p.rate_cents !== null
              ? e.fixedRate(formatMoney(p.rate_cents))
              : p.rate_type === "hourly" && p.rate_cents !== null
                ? e.hourlyRate(formatMoney(p.rate_cents))
                : null;
    const retail = p.retail_rate_bps ? e.retailRate(pct(p.retail_rate_bps)) : null;
    return [service, retail].filter((x) => x !== null).join(" · ");
}

/** Staff pay: each payee's earnings and tips, approved a few at a time and then paid together. */
export function useEarningApprovals(api: ApiLike): EarningApprovals {
    const earnings = useQuery<EarningRow>(ALL_EARNINGS_SQL);
    const staff = useQuery<PayeeRow>(PAYEES_SQL);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [picked, setPicked] = useState<string[]>([]);
    const key = useRef<string | null>(null);
    const { busy, error, run } = useAsyncAction();
    const year = String(new Date().getFullYear());
    const payees = useMemo(
        () =>
            staff.data.map((p) => {
                const mine = earnings.data.filter((r) => r.staff_id === p.id);
                const sum = (rows: EarningRow[]): number =>
                    rows.reduce((n, r) => n + r.amount_cents, 0);
                const pending = mine.filter((r) => r.status === "pending");
                return {
                    staffId: p.id,
                    name: staffName({ name: p.name, title: p.title, role: p.role }),
                    title: p.title,
                    color: p.color,
                    rates: rates(p),
                    pendingCents: sum(pending),
                    pendingCount: pending.length,
                    approvedCents: sum(mine.filter((r) => r.status === "approved")),
                    paidYtdCents: sum(
                        mine.filter((r) => r.status === "paid" && r.paid_at?.startsWith(year)),
                    ),
                    tipsCents: sum(mine.filter((r) => r.kind === "tip" && r.status !== "paid")),
                };
            }),
        [staff.data, earnings.data, year],
    );
    const selected = payees.find((p) => p.staffId === selectedId) ?? payees[0] ?? null;
    const rows = earnings.data.filter(
        (r) => r.staff_id === selected?.staffId && r.status !== "reversed",
    );
    const pendingIds = rows.filter((r) => r.status === "pending").map((r) => r.id);
    const shown = picked.filter((id) => pendingIds.includes(id));
    const load = useReplicaLoad([earnings, staff], payees.length === 0);
    const advance = (path: string, ids: string[], onDone: () => void): void => {
        key.current ??= newIdempotencyKey();
        const idempotencyKey = key.current;
        run(() => api.post(`/v1/earnings/${path}`, { ids }, { idempotencyKey }), {
            onSuccess: () => {
                key.current = null;
                onDone();
            },
            errorMessage: strings.earnings.updateError,
        });
    };
    return {
        load,
        payees,
        selected,
        select: (id) => {
            key.current = null;
            setPicked([]);
            setSelectedId(id);
        },
        lines: rows.map(earningLine),
        picked: shown,
        togglePick: (id) => {
            key.current = null;
            setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
        },
        pickAllPending: () => {
            key.current = null;
            setPicked(shown.length === pendingIds.length ? [] : pendingIds);
        },
        totals: {
            pendingCents: payees.reduce((n, p) => n + p.pendingCents, 0),
            approvedCents: payees.reduce((n, p) => n + p.approvedCents, 0),
            paidYtdCents: payees.reduce((n, p) => n + p.paidYtdCents, 0),
        },
        busy,
        error,
        approvePicked: () => {
            if (shown.length === 0) return;
            advance("approve", shown, () => {
                setPicked([]);
            });
        },
        payApproved: () => {
            const ids = rows.filter((r) => r.status === "approved").map((r) => r.id);
            if (ids.length === 0) return;
            advance("pay", ids, () => undefined);
        },
    };
}
