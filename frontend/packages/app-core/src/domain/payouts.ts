import { useBusinessQuery as useQuery, useRemote, useLoad } from "../hooks";
import { useBusinessId } from "./business";
import type { ApiLike } from "../api";

import { useState } from "react";

import { type Load } from "../hooks";
import { strings } from "../strings";
import { addDays, formatShortDay, parseTimestamp, useBusinessZone } from "../datetime";
import type { Intent } from "../ui";
import { formatMoney, formatParts } from "../format";
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

export const DEPOSITS_SINCE_SQL = `
SELECT COALESCE(SUM(e.amount_cents), 0) AS cents
FROM entries e JOIN accounts a ON a.id = e.account_id
WHERE a.owner_type = 'business' AND a.category = 'bank' AND e.event = 'payout'
  AND e.amount_cents > 0
  AND NOT EXISTS (SELECT 1 FROM entries r WHERE r.ref = e.ref || ':failed')
  AND ${utcFromSql("e.occurred_at", "?1")} AND ${utcSql("e.occurred_at")} >= datetime(?1)`;

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

interface PayoutContentsRow {
    id: string;
    source: string | null;
    kind: string;
    amount_cents: number;
    fee_cents: number;
    net_cents: number;
    currency: string;
    occurred_at: string;
}

interface PayoutContentsResponse {
    status: "available" | "pending" | "unavailable";
    transactions: PayoutContentsRow[];
    next_cursor: string | null;
}

interface PayoutContents {
    load: Load;
    status: PayoutContentsResponse["status"];
    rows: { id: string; title: string; detail: string; net: string }[];
    next: (() => void) | null;
    previous: (() => void) | null;
}

function usePayoutContents(
    api: ApiLike,
    businessId: string | null,
    payoutId: string | null,
): PayoutContents {
    const scope = `${businessId ?? ""}:${payoutId ?? ""}`;
    const [paging, setPaging] = useState<{ scope: string; cursors: string[] }>({
        scope,
        cursors: [],
    });
    const cursors = paging.scope === scope ? paging.cursors : [];
    const cursor = cursors.at(-1);
    const key = `${scope}:${cursor ?? ""}`;
    const remote = useRemote(
        async () => ({
            key,
            body:
                businessId === null || payoutId === null
                    ? null
                    : await api.get<PayoutContentsResponse>(
                          `/v1/connect/payouts/${payoutId}/transactions${cursor === undefined ? "" : `?after=${encodeURIComponent(cursor)}`}`,
                      ),
        }),
        key,
    );
    const data = remote.data?.key === key ? remote.data.body : null;
    const load = useReplicaLoad(
        [
            {
                ...remote,
                isLoading: remote.isLoading || (remote.error === null && remote.data?.key !== key),
            },
        ],
        false,
    );
    const nextCursor = data?.next_cursor;
    return {
        load,
        status: data?.status ?? "pending",
        rows: (data?.transactions ?? []).map((row) => ({
            id: row.id,
            title:
                row.kind === "charge" || row.kind === "payment"
                    ? strings.payouts.transactionCharge
                    : row.kind === "refund" || row.kind === "payment_refund"
                      ? strings.payouts.transactionRefund
                      : row.kind === "stripe_fee"
                        ? strings.payouts.transactionFee
                        : strings.payouts.transactionOther,
            detail: formatParts([
                formatMoney(row.amount_cents, row.currency),
                strings.payouts.transactionFees(formatMoney(row.fee_cents, row.currency)),
            ]),
            net: formatMoney(row.net_cents, row.currency),
        })),
        next: nextCursor
            ? () => {
                  setPaging({ scope, cursors: [...cursors, nextCursor] });
              }
            : null,
        previous:
            cursors.length > 0
                ? () => {
                      setPaging({ scope, cursors: cursors.slice(0, -1) });
                  }
                : null,
    };
}

export interface Payouts {
    load: Load;
    historyLoad: Load;
    payouts: PayoutView[];
    selected: PayoutView | null;
    select: (id: string) => void;
    balanceCents: number;
    depositedCents: number;
    feesCents: number;
    charges: ChargeView[];
    feesPending: number;
    contents: PayoutContents;
    next: (() => void) | null;
    previous: (() => void) | null;
}

/** Stripe payouts to the bank and the recent card charges with their fees, from the ledger. */
export function usePayouts(api: ApiLike): Payouts {
    const businessId = useBusinessId();
    const zone = useBusinessZone();
    const [since] = useState(() => addDays(new Date(), -30, zone).toISOString());
    const [paging, setPaging] = useState<{ businessId: string | null; cursors: string[] }>({
        businessId,
        cursors: [],
    });
    const cursors = paging.businessId === businessId ? paging.cursors : [];
    const cursor = cursors.at(-1);
    const key = `${businessId ?? ""}:${cursor ?? ""}`;
    const payouts = useRemote(
        async () => ({
            key,
            body:
                businessId === null
                    ? { payouts: [], next_cursor: null }
                    : await api.get<{ payouts: PayoutRow[]; next_cursor: string | null }>(
                          `/v1/connect/payouts${cursor === undefined ? "" : `?after=${encodeURIComponent(cursor)}`}`,
                      ),
        }),
        key,
    );
    const page = payouts.data?.key === key ? payouts.data.body : null;
    const nextCursor = page?.next_cursor;
    const deposits = useQuery<{ cents: number }>(DEPOSITS_SINCE_SQL, [since]);
    const balance = useQuery<{ cents: number }>(STRIPE_BALANCE_SQL);
    const fees = useQuery<{ cents: number }>(FEES_SINCE_SQL, [since]);
    const charges = useQuery<ChargeRow>(CARD_CHARGES_SQL, [since]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const views = (page?.payouts ?? []).map((p) => ({
        id: p.id,
        ref: p.id,
        amountCents: p.amount_cents,
        arrivalAt: p.arrival_at === null ? null : parseTimestamp(p.arrival_at),
        status: p.status,
        when: payoutWhen(p, zone),
    }));
    const selected = views.find((p) => p.id === selectedId) ?? views[0] ?? null;
    const contents = usePayoutContents(api, businessId, selected?.id ?? null);
    const chargeViews = charges.data.map((c) => ({
        id: c.id,
        client: c.client_name ?? strings.payouts.walkIn,
        description: chargeDescription(c),
        grossCents: c.amount_cents,
        refundedCents: c.refunded_cents,
        feeCents: c.fee_cents,
        netCents: c.amount_cents - c.refunded_cents - (c.fee_cents ?? 0),
    }));
    const historyLoad = useLoad(
        [
            {
                ...payouts,
                isLoading:
                    payouts.isLoading || (payouts.error === null && payouts.data?.key !== key),
            },
        ],
        views.length === 0,
    );
    const load = useReplicaLoad(
        [balance, fees, charges, deposits],
        historyLoad.state === "empty" && chargeViews.length === 0,
    );
    return {
        load,
        historyLoad,
        payouts: views,
        selected,
        contents,
        select: setSelectedId,
        balanceCents: balance.data[0]?.cents ?? 0,
        depositedCents: deposits.data[0]?.cents ?? 0,
        next: nextCursor
            ? () => {
                  setPaging({ businessId, cursors: [...cursors, nextCursor] });
              }
            : null,
        previous:
            cursors.length > 0
                ? () => {
                      setPaging({ businessId, cursors: cursors.slice(0, -1) });
                  }
                : null,
        feesCents: fees.data[0]?.cents ?? 0,
        charges: chargeViews,
        feesPending: chargeViews.filter((c) => c.feeCents === null).length,
    };
}
