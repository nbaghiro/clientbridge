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
import { Button, ListPage, Money, Notice, StatusPill } from "@clientbridge/ui";

import { api } from "../lib/api";

export function Earnings() {
    const rows = useEarnings();
    const { filter, setFilter, filters, shown, countOf } = useEarningFilter(rows);

    return (
        <ListPage
            summary={strings.earnings.subtitle}
            segments={{
                items: filters.map((f) => ({
                    key: f,
                    label: strings.earnings.filterTab(f, countOf(f)),
                })),
                active: filter,
                onSelect: setFilter,
            }}
            rows={shown}
            rowKey={(row) => row.id}
            empty={strings.earnings.empty(filter)}
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
                    <Button size="sm" busy={busy} onPress={approve}>
                        {busy ? strings.earnings.approving : strings.earnings.approve}
                    </Button>
                ) : null}
                {canPay ? (
                    <Button size="sm" busy={busy} onPress={pay}>
                        {busy ? strings.common.saving : strings.earnings.markPaid}
                    </Button>
                ) : null}
            </div>
            {error !== null ? <Notice tone="danger">{error}</Notice> : null}
        </div>
    );
}
