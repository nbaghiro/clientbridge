import { useQuery } from "@powersync/react";
import { useEffect, useState } from "react";

import { strings } from "../strings";
import type { ApiLike } from "../util/api";
import { isRefundRow } from "./payments";

export interface DashboardSummary {
    today_revenue_cents: number;
    awaiting_payment_cents: number;
    gst_hst_set_aside_cents: number;
}

/** Today dashboard money aggregates (REST — owner/admin only). `null` = loading, `"error"` =
 *  the fetch failed (e.g. 403 for staff). Bump `reloadKey` to refetch. */
export function useDashboardSummary(
    api: ApiLike,
    reloadKey = 0,
): DashboardSummary | "error" | null {
    const [summary, setSummary] = useState<DashboardSummary | "error" | null>(null);
    useEffect(() => {
        api.get<DashboardSummary>("/v1/dashboard/summary")
            .then(setSummary)
            .catch(() => {
                setSummary("error");
            });
    }, [api, reloadKey]);
    return summary;
}

export interface ActivityRow {
    id: string;
    kind: string;
    method: string;
    amount_cents: number;
    currency: string;
    status: string;
    created_at: string;
    client_name: string | null;
}

const RECENT_ACTIVITY_SQL = `
SELECT p.id, p.kind, p.method, p.amount_cents, p.currency, p.status, p.created_at, c.name AS client_name
FROM payments p LEFT JOIN clients c ON c.id = p.client_id
WHERE p.status = 'succeeded' ORDER BY p.created_at DESC LIMIT 12`;

/** Recent succeeded payments (with the paying client's name) for the Today activity feed. */
export function useRecentActivity(): ActivityRow[] {
    return useQuery<ActivityRow>(RECENT_ACTIVITY_SQL).data;
}

export function activityLabel(row: ActivityRow): string {
    if (isRefundRow(row)) return strings.home.activityRefund;
    if (row.kind === "deposit") return strings.home.activityDepositReceived;
    if (row.method === "interac") return strings.home.activityInteracReceived;
    if (row.method === "card") return strings.home.activityCardPayment;
    return strings.home.activityPayment;
}

export interface PayoutRow {
    id: string;
    amount_cents: number;
    status: string;
    arrival_at: string | null;
    bank_last4: string | null;
    created_at: string;
}

const RECENT_PAYOUTS_SQL = `
SELECT id, amount_cents, status, arrival_at, bank_last4, created_at
FROM payouts ORDER BY created_at DESC LIMIT 5`;

/** Recent payouts to the provider's bank (CAD; payouts carry no currency column). */
export function useRecentPayouts(): PayoutRow[] {
    return useQuery<PayoutRow>(RECENT_PAYOUTS_SQL).data;
}
