import {
    allocationSourceLabel,
    allocationStaffLabel,
    allocationStatusIntent,
    canManagePayments,
    formatMoney,
    formatRelativeTime,
    useAllocationActions,
    usePayoutFilter,
    useStaffPayouts,
    type AllocationRow,
} from "@clientbridge/app-core";

import { StatusPill } from "../components/StatusPill";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";

export function Payouts() {
    const role = useRole();

    if (!canManagePayments(role)) {
        return (
            <div className="mx-auto max-w-5xl px-8 py-8">
                <h1 className="font-display text-2xl font-bold text-ink">Payouts</h1>
                <p className="mt-0.5 text-sm text-muted">
                    Only owners and admins can manage staff payouts.
                </p>
            </div>
        );
    }

    return <PayoutsView />;
}

function PayoutsView() {
    const rows = useStaffPayouts();
    const { filter, setFilter, filters, shown, countOf } = usePayoutFilter(rows);

    return (
        <div className="mx-auto max-w-5xl px-8 py-8">
            <h1 className="font-display text-2xl font-bold text-ink">Payouts</h1>
            <p className="mt-0.5 text-sm text-muted">
                Approve staff earnings, then mark them paid out.
            </p>

            <div className="mt-6 flex gap-1 rounded-md border border-line bg-surface p-1 text-sm font-medium">
                {filters.map((f) => (
                    <button
                        key={f}
                        type="button"
                        onClick={() => {
                            setFilter(f);
                        }}
                        className={`flex-1 rounded px-3 py-1.5 capitalize transition ${
                            filter === f ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"
                        }`}
                    >
                        {f} ({countOf(f)})
                    </button>
                ))}
            </div>

            {shown.length === 0 ? (
                <p className="mt-8 text-center text-sm text-muted">
                    No {filter === "all" ? "" : `${filter} `}payouts.
                </p>
            ) : (
                <div className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface shadow-card">
                    {shown.map((row) => (
                        <AllocationItem key={row.id} row={row} />
                    ))}
                </div>
            )}
        </div>
    );
}

function AllocationItem({ row }: { row: AllocationRow }) {
    const { busy, error, canApprove, canPay, approve, pay } = useAllocationActions(api, row);

    return (
        <div className="px-4 py-3 text-sm">
            <div className="flex items-center gap-3">
                <div className="min-w-0">
                    <p className="font-medium text-ink">{allocationStaffLabel(row)}</p>
                    <p className="truncate text-xs text-muted">
                        {allocationSourceLabel(row.source_type)} ·{" "}
                        {formatRelativeTime(row.created_at)}
                    </p>
                </div>
                <span className="ml-auto shrink-0 font-medium tabular-nums text-ink">
                    {formatMoney(row.amount_cents)}
                </span>
                <StatusPill status={row.status} intent={allocationStatusIntent(row.status)} />
                {canApprove ? (
                    <button
                        type="button"
                        disabled={busy}
                        onClick={approve}
                        className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                    >
                        {busy ? "Approving…" : "Approve"}
                    </button>
                ) : null}
                {canPay ? (
                    <button
                        type="button"
                        disabled={busy}
                        onClick={pay}
                        className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                    >
                        {busy ? "Saving…" : "Mark paid"}
                    </button>
                ) : null}
            </div>
            {error !== null ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
        </div>
    );
}
