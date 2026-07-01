import { useQuery } from "@powersync/react";
import { useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import type { ApiLike } from "../util/api";
import type { Intent } from "../util/primitives";

export interface AllocationRow {
    id: string;
    staff_id: string;
    staff_title: string | null;
    staff_role: string | null;
    source_type: string;
    amount_cents: number;
    status: string;
    created_at: string;
}

// `users` isn't in the sync rules, so a staff name isn't reachably synced — we key the label off the
// synced `staff` row's title (falling back to role), mirroring `staffLabel`.
const ALLOCATIONS_SQL = `
SELECT a.id, a.staff_id, a.source_type, a.amount_cents, a.status, a.created_at,
       s.title AS staff_title, s.role AS staff_role
FROM payout_allocations a
LEFT JOIN staff s ON s.id = a.staff_id
ORDER BY CASE a.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, a.created_at DESC`;

/** Every staff payout allocation (joined to the staff row for a label), pending → approved → paid. */
export function useStaffPayouts(): AllocationRow[] {
    return useQuery<AllocationRow>(ALLOCATIONS_SQL).data;
}

const PENDING_ALLOCATIONS_SQL = `
SELECT a.id, a.staff_id, a.source_type, a.amount_cents, a.status, a.created_at,
       s.title AS staff_title, s.role AS staff_role
FROM payout_allocations a
LEFT JOIN staff s ON s.id = a.staff_id
WHERE a.status = 'pending'
ORDER BY a.created_at DESC`;

/** Allocations still awaiting approval — the actionable queue for a count/badge or quick review. */
export function usePendingAllocations(): AllocationRow[] {
    return useQuery<AllocationRow>(PENDING_ALLOCATIONS_SQL).data;
}

export type PayoutFilter = "pending" | "approved" | "paid" | "all";

export const PAYOUT_FILTERS: PayoutFilter[] = ["pending", "approved", "paid", "all"];

export interface PayoutFilterView {
    filter: PayoutFilter;
    setFilter: (f: PayoutFilter) => void;
    filters: PayoutFilter[];
    shown: AllocationRow[];
    countOf: (f: PayoutFilter) => number;
}

/** Shared payout-list filter: the status tabs, the active selection, the filtered rows, and the
 *  per-tab counts — so both Payouts screens render the same glue. */
export function usePayoutFilter(rows: AllocationRow[]): PayoutFilterView {
    const [filter, setFilter] = useState<PayoutFilter>("pending");
    const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);
    const countOf = (f: PayoutFilter): number =>
        f === "all" ? rows.length : rows.filter((r) => r.status === f).length;
    return { filter, setFilter, filters: PAYOUT_FILTERS, shown, countOf };
}

export function allocationStaffLabel(row: AllocationRow): string {
    const title = row.staff_title ?? "";
    return title.length > 0 ? title : (row.staff_role ?? "Staff");
}

export function allocationSourceLabel(sourceType: string): string {
    switch (sourceType) {
        case "booking":
            return "Booking";
        case "invoice_line":
            return "Invoice";
        case "class_session":
            return "Class";
        case "tip":
            return "Tip";
        case "sale":
            return "Sale";
        default:
            return sourceType;
    }
}

export function allocationStatusIntent(status: string): Intent {
    switch (status) {
        case "approved":
            return "accent";
        case "paid":
            return "success";
        default:
            return "warning"; // pending
    }
}

export interface AllocationResult {
    id: string;
    staff_id: string;
    amount_cents: number;
    status: string;
}

export function approveAllocation(api: ApiLike, id: string): Promise<AllocationResult> {
    return api.post<AllocationResult>(`/v1/payouts/allocations/${id}/approve`, {});
}

export function payAllocation(api: ApiLike, id: string): Promise<AllocationResult> {
    return api.post<AllocationResult>(`/v1/payouts/allocations/${id}/pay`, {});
}

export interface AllocationActions {
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
export function useAllocationActions(
    api: ApiLike,
    row: AllocationRow,
    onDone?: () => void,
): AllocationActions {
    const { busy, error, run } = useAsyncAction();

    const approve = (): void => {
        void run(() => approveAllocation(api, row.id), {
            onSuccess: () => onDone?.(),
            errorMessage: "Couldn't approve this payout. Please try again.",
        });
    };
    const pay = (): void => {
        void run(() => payAllocation(api, row.id), {
            onSuccess: () => onDone?.(),
            errorMessage: "Couldn't mark this payout paid. Please try again.",
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
