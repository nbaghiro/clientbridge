import { formatMoneyWithCurrency, useDashboardSummary } from "@clientbridge/app-core";

import { api } from "../lib/api";

export function Today() {
    const summary = useDashboardSummary(api);

    return (
        <div className="mx-auto max-w-5xl px-8 py-8">
            <h1 className="font-display text-2xl font-bold text-ink">Today</h1>
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
