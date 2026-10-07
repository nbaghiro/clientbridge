import { useQuery } from "@powersync/react";
import { useState } from "react";

import { type Load } from "../hooks";
import { strings } from "../strings";
import { addDays, formatShortDay, parseTimestamp } from "../datetime";
import type { Intent } from "../ui";
import { utcSql } from "./bookings";
import { useReplicaLoad } from "./sync";

interface PayoutRow {
    id: string;
    payout_ref: string | null;
    amount_cents: number;
    arrival_at: string | null;
    occurred_at: string;
    status: "paid" | "failed";
}

// A Stripe payout is its ledger journal (bank in, Stripe out); a returned one was reversed.
export const PAYOUTS_SQL = `
SELECT e.journal_id AS id, e.source_id AS payout_ref, e.amount_cents,
       e.available_at AS arrival_at, e.occurred_at,
       CASE WHEN EXISTS (SELECT 1 FROM entries x WHERE x.ref = e.ref || ':failed')
            THEN 'failed' ELSE 'paid' END AS status
FROM entries e JOIN accounts a ON a.id = e.account_id
WHERE e.event = 'payout' AND a.category = 'bank'
ORDER BY e.occurred_at DESC LIMIT 24`;

export const STRIPE_BALANCE_SQL = `
SELECT COALESCE(SUM(balance_cents), 0) AS cents FROM accounts
WHERE owner_type = 'business' AND category = 'stripe'`;

// Stripe's and the platform's fee on each charge, from the charge's balance transaction.
export const FEES_SINCE_SQL = `
SELECT COALESCE(SUM(e.amount_cents), 0) AS cents
FROM entries e JOIN accounts a ON a.id = e.account_id
WHERE a.owner_type = 'business' AND a.category IN ('processing_fee', 'platform_fee')
  AND ${utcSql("e.occurred_at")} >= datetime(?)`;

interface ChargeRow {
    id: string;
    amount_cents: number;
    paid_at: string | null;
    kind: string;
    client_name: string | null;
    invoice_number: number | null;
    order_number: number | null;
    fee_cents: number | null;
    refunded_cents: number;
}

export const CARD_CHARGES_SQL = `
SELECT p.id, p.amount_cents, p.paid_at, p.kind, c.name AS client_name,
       i.number AS invoice_number, o.number AS order_number,
       (SELECT SUM(le.amount_cents) FROM entries le JOIN accounts la ON la.id = le.account_id
        WHERE le.ref = 'fee:' || p.id AND la.category IN ('processing_fee', 'platform_fee')) AS fee_cents,
       COALESCE((SELECT SUM(r.amount_cents) FROM payments r
                 WHERE r.parent_payment_id = p.id AND r.kind = 'refund' AND r.status = 'succeeded'), 0)
           AS refunded_cents
FROM payments p
LEFT JOIN clients c ON c.id = p.client_id
LEFT JOIN invoices i ON i.id = p.invoice_id
LEFT JOIN orders o ON o.id = p.order_id
WHERE p.provider = 'stripe' AND p.kind IN ('payment', 'deposit')
  AND p.status IN ('succeeded', 'refunded')
  AND ${utcSql("COALESCE(p.paid_at, p.created_at)")} >= datetime(?)
ORDER BY COALESCE(p.paid_at, p.created_at) DESC LIMIT 50`;

export interface PayoutView {
    id: string;
    ref: string | null;
    amountCents: number;
    arrivalAt: Date | null;
    status: "paid" | "failed";
    when: string;
}

export interface ChargeView {
    id: string;
    client: string;
    description: string;
    grossCents: number;
    refundedCents: number;
    feeCents: number | null;
    netCents: number;
}

export function payoutStatusIntent(status: string): Intent {
    return status === "failed" ? "danger" : "success";
}

function payoutWhen(row: PayoutRow): string {
    const at = row.arrival_at ?? row.occurred_at;
    const when = formatShortDay(parseTimestamp(at));
    return row.status === "failed" ? strings.payouts.returned(when) : strings.payouts.arrived(when);
}

function chargeDescription(row: ChargeRow): string {
    if (row.invoice_number !== null) return strings.payouts.invoiceCharge(row.invoice_number);
    if (row.order_number !== null) return strings.payouts.saleCharge(row.order_number);
    if (row.kind === "deposit") return strings.payouts.depositCharge;
    return strings.payouts.prepaidCharge;
}

export interface Payouts {
    load: Load;
    payouts: PayoutView[];
    selected: PayoutView | null;
    select: (id: string) => void;
    balanceCents: number;
    depositedCents: number;
    feesCents: number;
    charges: ChargeView[];
    feesPending: number;
}

/** Stripe payouts to the bank and the recent card charges with their fees, from the ledger. */
export function usePayouts(): Payouts {
    const [since] = useState(() => addDays(new Date(), -30).toISOString());
    const payouts = useQuery<PayoutRow>(PAYOUTS_SQL);
    const balance = useQuery<{ cents: number }>(STRIPE_BALANCE_SQL);
    const fees = useQuery<{ cents: number }>(FEES_SINCE_SQL, [since]);
    const charges = useQuery<ChargeRow>(CARD_CHARGES_SQL, [since]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const views = payouts.data.map((p) => ({
        id: p.id,
        ref: p.payout_ref,
        amountCents: p.amount_cents,
        arrivalAt: p.arrival_at === null ? null : parseTimestamp(p.arrival_at),
        status: p.status,
        when: payoutWhen(p),
    }));
    const chargeViews = charges.data.map((c) => ({
        id: c.id,
        client: c.client_name ?? strings.payouts.walkIn,
        description: chargeDescription(c),
        grossCents: c.amount_cents,
        refundedCents: c.refunded_cents,
        feeCents: c.fee_cents,
        netCents: c.amount_cents - c.refunded_cents - (c.fee_cents ?? 0),
    }));
    const cutoff = new Date(since);
    const load = useReplicaLoad(
        [payouts, balance, fees, charges],
        views.length === 0 && chargeViews.length === 0,
    );
    return {
        load,
        payouts: views,
        selected: views.find((p) => p.id === selectedId) ?? views[0] ?? null,
        select: setSelectedId,
        balanceCents: balance.data[0]?.cents ?? 0,
        depositedCents: views
            .filter((p) => p.status === "paid" && (p.arrivalAt ?? new Date(0)) >= cutoff)
            .reduce((n, p) => n + p.amountCents, 0),
        feesCents: fees.data[0]?.cents ?? 0,
        charges: chargeViews,
        feesPending: chargeViews.filter((c) => c.feeCents === null).length,
    };
}
