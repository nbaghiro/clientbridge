import { useQuery } from "@powersync/react";
import { useEffect, useState } from "react";

import { strings } from "../strings";
import type { ApiLike } from "../api";
import { isRefundRow } from "./payments";

interface TodaySummary {
    today_revenue_cents: number;
    awaiting_payment_cents: number;
    gst_hst_set_aside_cents: number;
}

/** `null` while loading, `"error"` if the fetch failed (403 for staff); bump `reloadKey` to refetch. */
export function useTodaySummary(api: ApiLike, reloadKey = 0): TodaySummary | "error" | null {
    const [summary, setSummary] = useState<TodaySummary | "error" | null>(null);
    useEffect(() => {
        api.get<TodaySummary>("/v1/dashboard/summary")
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
    at: string;
    client_name: string | null;
}

export const RECENT_ACTIVITY_SQL = `
SELECT p.id, p.kind, p.method, p.amount_cents, p.currency, p.status,
       COALESCE(p.paid_at, p.created_at) AS at, c.name AS client_name
FROM payments p LEFT JOIN clients c ON c.id = p.client_id
WHERE p.status = 'succeeded' ORDER BY at DESC LIMIT 12`;

export function useRecentActivity(): ActivityRow[] {
    return useQuery<ActivityRow>(RECENT_ACTIVITY_SQL).data;
}

export function activityLabel(row: ActivityRow): string {
    if (isRefundRow(row)) return strings.today.activityRefund;
    if (row.kind === "deposit") return strings.today.activityDepositReceived;
    if (row.method === "interac") return strings.today.activityInteracReceived;
    if (row.method === "card") return strings.today.activityCardPayment;
    return strings.today.activityPayment;
}
