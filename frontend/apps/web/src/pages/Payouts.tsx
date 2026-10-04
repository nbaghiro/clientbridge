import {
    earningSourceLabel,
    earningStaffLabel,
    earningStatusIntent,
    formatRelativeTime,
    strings,
    useEarningActions,
    useEarningFilter,
    useEarnings,
    type EarningRow,
} from "@clientbridge/app-core";
import { StatusPill } from "@clientbridge/ui";

import { ListPage } from "../components/ListPage";
import { Money } from "../components/Money";
import { api } from "../lib/api";

export function Payouts() {
    const rows = useEarnings();
    const { filter, setFilter, filters, shown, countOf } = useEarningFilter(rows);

    return (
        <ListPage
            summary={strings.payouts.subtitle}
            segments={{
                items: filters.map((f) => ({
                    key: f,
                    label: strings.payouts.filterTab(f, countOf(f)),
                })),
                active: filter,
                onSelect: setFilter,
            }}
            rows={shown}
            rowKey={(row) => row.id}
            empty={strings.payouts.empty(filter)}
            renderRow={(row) => <EarningItem row={row} />}
        />
    );
}

function EarningItem({ row }: { row: EarningRow }) {
    const { busy, error, canApprove, canPay, approve, pay } = useEarningActions(api, row);

    return (
        <div>
            <div className="flex items-center gap-3">
                <div className="min-w-0">
                    <p className="font-medium text-ink">{earningStaffLabel(row)}</p>
                    <p className="truncate text-xs text-muted">
                        {earningSourceLabel(row)} · {formatRelativeTime(row.created_at)}
                    </p>
                </div>
                <span className="ml-auto shrink-0">
                    <Money cents={row.amount_cents} />
                </span>
                <StatusPill status={row.status} intent={earningStatusIntent(row.status)} />
                {canApprove ? (
                    <button
                        type="button"
                        disabled={busy}
                        onClick={approve}
                        className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                    >
                        {busy ? strings.payouts.approving : strings.payouts.approve}
                    </button>
                ) : null}
                {canPay ? (
                    <button
                        type="button"
                        disabled={busy}
                        onClick={pay}
                        className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                    >
                        {busy ? strings.common.saving : strings.payouts.markPaid}
                    </button>
                ) : null}
            </div>
            {error !== null ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
        </div>
    );
}
