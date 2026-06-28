import { useEffect, useState } from "react";

import type { ApiLike } from "../util/api";

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
        void api
            .get<DashboardSummary>("/v1/dashboard/summary")
            .then(setSummary)
            .catch(() => {
                setSummary("error");
            });
    }, [api, reloadKey]);
    return summary;
}
