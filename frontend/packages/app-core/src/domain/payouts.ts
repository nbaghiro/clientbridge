import { useBusinessQuery as useQuery, useRemote } from "../hooks";
import { useBusinessId } from "./business";
import type { ApiLike } from "../api";

import { useState } from "react";

import { type Load } from "../hooks";
import { strings } from "../strings";
import { addDays, formatShortDay, parseTimestamp, useBusinessZone } from "../datetime";
import type { Intent } from "../ui";
import { utcFromSql, utcSql } from "../datetime";
import { useReplicaLoad } from "./sync";

interface PayoutRow {
    id: string;
    amount_cents: number;
    arrival_at: string | null;
    occurred_at: string;
    status: "pending" | "in_transit" | "paid" | "failed" | "canceled";
}

export const STRIPE_BALANCE_SQL = `
SELECT COALESCE(SUM(balance_cents), 0) AS cents FROM accounts
WHERE owner_type = 'business' AND category = 'stripe'`;

// Stripe's and the platform's fee on each charge, from the charge's balance transaction.
export const FEES_SINCE_SQL = `
SELECT COALESCE(SUM(e.amount_cents), 0) AS cents
FROM entries e JOIN accounts a ON a.id = e.account_id
WHERE a.owner_type = 'business' AND a.category IN ('processing_fee', 'platform_fee')
  AND ${utcFromSql("e.occurred_at", "?1")} AND ${utcSql("e.occurred_at")} >= datetime(?1)`;

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
  AND p.status = 'succeeded'
  AND ${utcSql("COALESCE(p.paid_at, p.created_at)")} >= datetime(?)
ORDER BY COALESCE(p.paid_at, p.created_at) DESC LIMIT 50`;

interface PayoutView {
    id: string;
    ref: string | null;
    amountCents: number;
    arrivalAt: Date | null;
    status: "pending" | "in_transit" | "paid" | "failed" | "canceled";
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
    return status === "failed" || status === "canceled"
        ? "danger"
        : status === "paid"
          ? "success"
          : "neutral";
}

function payoutWhen(row: PayoutRow, zone: string): string {
    const at = row.arrival_at ?? row.occurred_at;
    const when = formatShortDay(parseTimestamp(at), zone);
    if (row.status === "failed" || row.status === "canceled") return strings.payouts.returned(when);
    return row.status === "paid" ? strings.payouts.arrived(when) : strings.payouts.expected(when);
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
export function usePayouts(api: ApiLike): Payouts {
    const businessId = useBusinessId();
    const zone = useBusinessZone();
    const [since] = useState(() => addDays(new Date(), -30, zone).toISOString());
    const payouts = useRemote(
        () =>
            businessId === null ? Promise.resolve([]) : api.get<PayoutRow[]>("/v1/connect/payouts"),
        businessId ?? "",
    );
    const balance = useQuery<{ cents: number }>(STRIPE_BALANCE_SQL);
    const fees = useQuery<{ cents: number }>(FEES_SINCE_SQL, [since]);
    const charges = useQuery<ChargeRow>(CARD_CHARGES_SQL, [since]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const views = (payouts.data ?? []).map((p) => ({
        id: p.id,
        ref: p.id,
        amountCents: p.amount_cents,
        arrivalAt: p.arrival_at === null ? null : parseTimestamp(p.arrival_at),
        status: p.status,
        when: payoutWhen(p, zone),
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
