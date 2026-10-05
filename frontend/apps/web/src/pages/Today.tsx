import {
    activityLabel,
    canManagePayments,
    formatMoneyWithCurrency,
    formatRelativeTime,
    isRefundRow,
    strings,
    useDashboardSummary,
    useRecentActivity,
    type ActivityRow,
} from "@clientbridge/app-core";
import { ListPage, Money } from "@clientbridge/ui";

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
    const summary = useDashboardSummary(api);
    const activity = useRecentActivity();

    return (
        <>
            <p className="mt-0.5 text-sm text-muted">{strings.today.moneySubtitle}</p>

            {summary === "error" ? (
                <p className="mt-6 text-sm text-muted">{strings.today.numbersError}</p>
            ) : (
                <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <StatCard
                        label={strings.today.todayRevenue}
                        cents={summary === null ? null : summary.today_revenue_cents}
                        caption={strings.today.todayRevenueCaption}
                        tone="success"
                    />
                    <StatCard
                        label={strings.today.awaitingPayment}
                        cents={summary === null ? null : summary.awaiting_payment_cents}
                        caption={strings.today.awaitingPaymentCaption}
                    />
                    <StatCard
                        label={strings.today.gstSetAside}
                        cents={summary === null ? null : summary.gst_hst_set_aside_cents}
                        caption={strings.today.gstSetAsideCaption}
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

function StatCard({
    label,
    cents,
    caption,
    tone = "ink",
}: {
    label: string;
    cents: number | null;
    caption: string;
    tone?: "ink" | "success";
}) {
    return (
        <div className="rounded-lg border border-line bg-surface p-5 shadow-card">
            <p className="text-sm text-muted">{label}</p>
            {cents === null ? (
                <div className="mt-2 h-8 w-32 animate-pulse rounded-base bg-bg" />
            ) : (
                <p
                    className={`mt-1 font-display text-3xl font-bold tabular-nums ${
                        tone === "success" ? "text-success" : "text-ink"
                    }`}
                >
                    {formatMoneyWithCurrency(cents, "CAD")}
                </p>
            )}
            <p className="mt-1.5 text-xs text-muted">{caption}</p>
        </div>
    );
}
