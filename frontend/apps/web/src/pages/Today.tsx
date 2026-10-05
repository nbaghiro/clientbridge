import {
    activityLabel,
    canManagePayments,
    formatRelativeTime,
    isRefundRow,
    strings,
    useTodaySummary,
    useRecentActivity,
    type ActivityRow,
} from "@clientbridge/app-core";
import { ListPage, Money, Stat } from "@clientbridge/ui";

import { api } from "../lib/api";
import { useRole } from "../lib/auth";

export function Today() {
    const role = useRole();

    return (
        <div className="mx-auto max-w-5xl px-8 py-8">
            <h1 className="font-display text-2xl font-bold text-ink">{strings.today.title}</h1>
            {canManagePayments(role) ? (
                <MoneyView />
            ) : (
                <p className="mt-0.5 text-sm text-muted">{strings.today.staffSubtitle}</p>
            )}
        </div>
    );
}

function MoneyView() {
    const summary = useTodaySummary(api);
    const activity = useRecentActivity();

    return (
        <>
            <p className="mt-0.5 text-sm text-muted">{strings.today.moneySubtitle}</p>

            {summary === "error" ? (
                <p className="mt-6 text-sm text-muted">{strings.today.numbersError}</p>
            ) : (
                <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Stat
                        size="lg"
                        label={strings.today.todayRevenue}
                        cents={summary === null ? null : summary.today_revenue_cents}
                        hint={strings.today.todayRevenueCaption}
                        tone="success"
                    />
                    <Stat
                        size="lg"
                        label={strings.today.awaitingPayment}
                        cents={summary === null ? null : summary.awaiting_payment_cents}
                        hint={strings.today.awaitingPaymentCaption}
                    />
                    <Stat
                        size="lg"
                        label={strings.today.gstSetAside}
                        cents={summary === null ? null : summary.gst_hst_set_aside_cents}
                        hint={strings.today.gstSetAsideCaption}
                    />
                </div>
            )}

            <div className="mt-8">
                <ListPage
                    head={strings.today.recentActivity}
                    rows={activity}
                    rowKey={(row) => row.id}
                    empty={strings.today.noPayments}
                    renderRow={(row) => <ActivityItem row={row} />}
                />
            </div>
        </>
    );
}

function ActivityItem({ row }: { row: ActivityRow }) {
    const refund = isRefundRow(row);
    return (
        <div className="flex items-center gap-3">
            <div className="min-w-0">
                <p className="font-medium text-ink">{activityLabel(row)}</p>
                {row.client_name !== null ? (
                    <p className="truncate text-xs text-muted">{row.client_name}</p>
                ) : null}
            </div>
            <span className={`ml-auto shrink-0 ${refund ? "text-danger" : ""}`}>
                {refund ? "−" : ""}
                <Money cents={row.amount_cents} tone={refund ? "danger" : "ink"} />
            </span>
            <span className="w-12 shrink-0 text-right text-xs text-muted">
                {formatRelativeTime(row.at)}
            </span>
        </div>
    );
}
