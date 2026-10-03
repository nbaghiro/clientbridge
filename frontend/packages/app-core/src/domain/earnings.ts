import { useQuery } from "@powersync/react";
import { useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import type { ApiLike } from "../util/api";
import type { Intent } from "../util/primitives";
import { strings } from "../strings";

export interface EarningRow {
    id: string;
    staff_id: string;
    staff_title: string | null;
    staff_role: string | null;
    booking_id: string | null;
    amount_cents: number;
    status: string;
    created_at: string;
}

// An earning is its accrual journal; how far it has gone is whether its approval, staff payment, or
// reversal journal exists (the same rule the server applies). `users` isn't synced, so the label
// keys off the synced `staff` row's title, falling back to role.
const EARNINGS_SQL = `
SELECT * FROM (
    SELECT e.journal_id AS id, e.owner_id AS staff_id, -e.amount_cents AS amount_cents,
           e.subject_id AS booking_id, e.occurred_at AS created_at,
           s.title AS staff_title, s.role AS staff_role,
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
    LEFT JOIN staff s ON s.id = e.owner_id
    WHERE e.type = 'earning' AND e.owner_type = 'staff'
)`;

const ALL_EARNINGS_SQL = `${EARNINGS_SQL}
ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, created_at DESC`;

/** Every staff earning, pending → approved → paid (reversed ones sort last). */
export function useEarnings(): EarningRow[] {
    return useQuery<EarningRow>(ALL_EARNINGS_SQL).data;
}

const PENDING_EARNINGS_SQL = `${EARNINGS_SQL}
WHERE status = 'pending' ORDER BY created_at DESC`;

/** Earnings still awaiting approval — the actionable queue for a count/badge or quick review. */
export function usePendingEarnings(): EarningRow[] {
    return useQuery<EarningRow>(PENDING_EARNINGS_SQL).data;
}

export type EarningFilter = "pending" | "approved" | "paid" | "all";

export const EARNING_FILTERS: EarningFilter[] = ["pending", "approved", "paid", "all"];

export interface EarningFilterView {
    filter: EarningFilter;
    setFilter: (f: EarningFilter) => void;
    filters: EarningFilter[];
    shown: EarningRow[];
    countOf: (f: EarningFilter) => number;
}

/** Shared earnings-list filter: the status tabs, the active selection, the filtered rows, and the
 *  per-tab counts — so both Payouts screens render the same glue. */
export function useEarningFilter(rows: EarningRow[]): EarningFilterView {
    const [filter, setFilter] = useState<EarningFilter>("pending");
    const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);
    const countOf = (f: EarningFilter): number =>
        f === "all" ? rows.length : rows.filter((r) => r.status === f).length;
    return { filter, setFilter, filters: EARNING_FILTERS, shown, countOf };
}

export function earningStaffLabel(row: EarningRow): string {
    const title = row.staff_title ?? "";
    return title.length > 0 ? title : (row.staff_role ?? strings.payouts.staffFallback);
}

export function earningStatusIntent(status: string): Intent {
    switch (status) {
        case "approved":
            return "accent";
        case "paid":
            return "success";
        case "reversed":
            return "neutral";
        default:
            return "warning"; // pending
    }
}

export interface EarningResult {
    id: string;
    staff_id: string;
    booking_id: string | null;
    amount_cents: number;
    status: string;
}

export function approveEarning(api: ApiLike, id: string): Promise<EarningResult> {
    return api.post<EarningResult>(`/v1/earnings/${id}/approve`, {});
}

export function payEarning(api: ApiLike, id: string): Promise<EarningResult> {
    return api.post<EarningResult>(`/v1/earnings/${id}/pay`, {});
}

export interface EarningActions {
    busy: boolean;
    error: string | null;
    canApprove: boolean;
    canPay: boolean;
    approve: () => void;
    pay: () => void;
}

/** The approve → pay lifecycle as a view-model: which action is available for the row's status, plus
 *  busy/error from the shared async primitive. The synced row updates itself once the command lands,
 *  so `onDone` is only for surfaces that want to react (e.g. close a sheet). */
export function useEarningActions(
    api: ApiLike,
    row: EarningRow,
    onDone?: () => void,
): EarningActions {
    const { busy, error, run } = useAsyncAction();

    const approve = (): void => {
        run(() => approveEarning(api, row.id), {
            onSuccess: () => onDone?.(),
            errorMessage: strings.payouts.approveError,
        });
    };
    const pay = (): void => {
        run(() => payEarning(api, row.id), {
            onSuccess: () => onDone?.(),
            errorMessage: strings.payouts.markPaidError,
        });
    };

    return {
        busy,
        error,
        canApprove: row.status === "pending",
        canPay: row.status === "approved",
        approve,
        pay,
    };
}
