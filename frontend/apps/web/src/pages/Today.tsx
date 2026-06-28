import {
    activityLabel,
    canManagePayments,
    formatMoneyWithCurrency,
    formatMonthDay,
    formatRelativeTime,
    isRefundRow,
    parseTimestamp,
    paymentStatusIntent,
    useCurrentRole,
    useDashboardSummary,
    useRecentActivity,
    useRecentPayouts,
    type ActivityRow,
    type PayoutRow,
} from "@clientbridge/app-core";

import { StatusPill } from "../components/StatusPill";
import { api } from "../lib/api";
import { getTokens } from "../lib/auth";

export function Today() {
    const role = useCurrentRole(getTokens()?.access_token ?? null);

    return (
        <div className="mx-auto max-w-5xl px-8 py-8">
            <h1 className="font-display text-2xl font-bold text-ink">Today</h1>
            {canManagePayments(role) ? (
                <MoneyView />
            ) : (
                <p className="mt-0.5 text-sm text-muted">
                    Your schedule and clients are in the tabs above.
                </p>
            )}
        </div>
    );
}

function MoneyView() {
    const summary = useDashboardSummary(api);
    const activity = useRecentActivity();
    const payouts = useRecentPayouts();

    return (
        <>
            <p className="mt-0.5 text-sm text-muted">Your money at a glance.</p>

            {summary === "error" ? (
                <p className="mt-6 text-sm text-muted">Couldn’t load your numbers.</p>
            ) : (
                <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <StatCard
                        label="Today's revenue"
                        cents={summary === null ? null : summary.today_revenue_cents}
                        caption="received today"
                        tone="success"
                    />
                    <StatCard
                        label="Awaiting payment"
                        cents={summary === null ? null : summary.awaiting_payment_cents}
                        caption="outstanding invoices"
                    />
                    <StatCard
                        label="GST/HST set aside"
                        cents={summary === null ? null : summary.gst_hst_set_aside_cents}
                        caption="remit to CRA"
                    />
                </div>
            )}

            <section className="mt-8">
                <h2 className="font-display text-lg font-semibold text-ink">Recent activity</h2>
                {activity.length === 0 ? (
                    <p className="mt-2 text-sm text-muted">No payments yet.</p>
                ) : (
                    <div className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface shadow-card">
                        {activity.map((row) => (
                            <ActivityItem key={row.id} row={row} />
                        ))}
                    </div>
                )}
            </section>

            <section className="mt-8">
                <h2 className="font-display text-lg font-semibold text-ink">Payouts</h2>
                {payouts.length === 0 ? (
                    <p className="mt-2 text-sm text-muted">No payouts yet.</p>
                ) : (
                    <div className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface shadow-card">
                        {payouts.map((row) => (
                            <PayoutItem key={row.id} row={row} />
                        ))}
                    </div>
                )}
            </section>
        </>
    );
}

function ActivityItem({ row }: { row: ActivityRow }) {
    const refund = isRefundRow(row);
    return (
        <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <div className="min-w-0">
                <p className="font-medium text-ink">{activityLabel(row)}</p>
                {row.client_name !== null ? (
                    <p className="truncate text-xs text-muted">{row.client_name}</p>
                ) : null}
            </div>
            <span
                className={`ml-auto shrink-0 font-medium tabular-nums ${
                    refund ? "text-danger" : "text-ink"
                }`}
            >
                {refund ? "−" : ""}
                {formatMoneyWithCurrency(row.amount_cents, row.currency)}
            </span>
            <span className="w-12 shrink-0 text-right text-xs text-muted">
                {formatRelativeTime(row.created_at)}
            </span>
        </div>
    );
}

function PayoutItem({ row }: { row: PayoutRow }) {
    return (
        <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="font-medium tabular-nums text-ink">
                {formatMoneyWithCurrency(row.amount_cents, "CAD")}
            </span>
            <StatusPill status={row.status} intent={paymentStatusIntent(row.status)} />
            {row.bank_last4 !== null ? (
                <span className="text-xs text-muted">to ····{row.bank_last4}</span>
            ) : null}
            {row.arrival_at !== null ? (
                <span className="ml-auto shrink-0 text-xs text-muted">
                    {formatMonthDay(parseTimestamp(row.arrival_at))}
                </span>
            ) : null}
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
                <div className="mt-2 h-8 w-32 animate-pulse rounded bg-bg" />
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
