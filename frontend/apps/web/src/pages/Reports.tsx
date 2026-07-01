import {
    type ReportRange,
    type T4ARow,
    canManagePayments,
    defaultReportRange,
    formatMoney,
    strings,
    useReportDownload,
    useReports,
} from "@clientbridge/app-core";
import { useState } from "react";

import { api } from "../lib/api";
import { useRole } from "../lib/auth";

export function Reports() {
    const role = useRole();

    if (!canManagePayments(role)) {
        return (
            <div className="mx-auto max-w-5xl px-8 py-8">
                <h1 className="font-display text-2xl font-bold text-ink">
                    {strings.reports.title}
                </h1>
                <p className="mt-2 text-sm text-muted">{strings.reports.accessRestricted}</p>
            </div>
        );
    }

    return <ReportsView />;
}

function ReportsView() {
    const [range, setRange] = useState<ReportRange>(defaultReportRange());
    const { income, gstHst, t4a, loading, error } = useReports(api, range);
    const {
        error: dlError,
        isDownloading,
        download,
    } = useReportDownload(api, range, (csv, filename) => {
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    });

    return (
        <div className="mx-auto max-w-5xl px-8 py-8">
            <header>
                <h1 className="font-display text-2xl font-bold text-ink">
                    {strings.reports.title}
                </h1>
                <p className="mt-0.5 text-sm text-muted">{strings.reports.subtitle}</p>
            </header>

            <div className="mt-6 flex flex-wrap items-end gap-4 rounded-lg border border-line bg-surface p-4">
                <RangeField
                    label={strings.reports.rangeFrom}
                    value={range.start}
                    onChange={(start) => {
                        setRange((r) => ({ ...r, start }));
                    }}
                />
                <RangeField
                    label={strings.reports.rangeTo}
                    value={range.end}
                    onChange={(end) => {
                        setRange((r) => ({ ...r, end }));
                    }}
                />
                <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                    {strings.reports.t4aYear}
                    <input
                        type="number"
                        value={range.year}
                        onChange={(e) => {
                            setRange((r) => ({ ...r, year: Number(e.target.value) || r.year }));
                        }}
                        className="w-28 rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                    />
                </label>
            </div>

            {dlError !== null ? <p className="mt-3 text-sm text-danger">{dlError}</p> : null}

            {error ? (
                <p className="mt-6 text-sm text-muted">{strings.reports.loadError}</p>
            ) : (
                <div className="mt-6 space-y-5">
                    <Card
                        title={strings.reports.incomeTitle}
                        subtitle={strings.reports.incomeSubtitle}
                        onDownload={() => {
                            download("income");
                        }}
                        downloading={isDownloading("income")}
                    >
                        {income === null ? (
                            <Skeleton />
                        ) : (
                            <>
                                <div className="grid gap-4 sm:grid-cols-3">
                                    <Figure
                                        label={strings.reports.gross}
                                        cents={income.gross_cents}
                                    />
                                    <Figure
                                        label={strings.reports.refunds}
                                        cents={income.refunds_cents}
                                        tone="danger"
                                    />
                                    <Figure
                                        label={strings.reports.net}
                                        cents={income.net_cents}
                                        tone="success"
                                    />
                                </div>
                                {Object.keys(income.by_method).length > 0 ? (
                                    <table className="mt-4 w-full text-sm">
                                        <tbody>
                                            {Object.entries(income.by_method).map(
                                                ([method, cents]) => (
                                                    <tr
                                                        key={method}
                                                        className="border-t border-line-soft"
                                                    >
                                                        <td className="py-2 capitalize text-ink-soft">
                                                            {method}
                                                        </td>
                                                        <td className="py-2 text-right font-medium tabular-nums text-ink">
                                                            {formatMoney(cents)}
                                                        </td>
                                                    </tr>
                                                ),
                                            )}
                                        </tbody>
                                    </table>
                                ) : null}
                            </>
                        )}
                    </Card>

                    <Card
                        title={strings.reports.gstTitle}
                        subtitle={strings.reports.gstSubtitle}
                        onDownload={() => {
                            download("gst-hst");
                        }}
                        downloading={isDownloading("gst-hst")}
                    >
                        {gstHst === null ? (
                            <Skeleton />
                        ) : (
                            <>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <Figure
                                        label={strings.reports.taxCollected}
                                        cents={gstHst.tax_collected_cents}
                                        tone="success"
                                    />
                                    <Figure
                                        label={strings.reports.taxableSales}
                                        cents={gstHst.taxable_sales_cents}
                                    />
                                </div>
                                <p className="mt-3 text-sm text-muted">
                                    {strings.reports.gstNumberLabel}:{" "}
                                    <span className="font-medium text-ink">
                                        {gstHst.gst_hst_number ?? strings.reports.notRegistered}
                                    </span>
                                </p>
                            </>
                        )}
                    </Card>

                    <Card
                        title={strings.reports.t4aTitle(range.year)}
                        subtitle={strings.reports.t4aSubtitle}
                        onDownload={() => {
                            download("t4a");
                        }}
                        downloading={isDownloading("t4a")}
                    >
                        {t4a === null ? (
                            <Skeleton />
                        ) : t4a.length === 0 ? (
                            <p className="text-sm text-muted">
                                {strings.reports.noPayeeAmounts(range.year)}
                            </p>
                        ) : (
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-xs uppercase tracking-wide text-muted">
                                        <th className="pb-2 font-semibold">
                                            {strings.reports.colPayee}
                                        </th>
                                        <th className="pb-2 text-right font-semibold">
                                            {strings.reports.colTotal}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {t4a.map((row: T4ARow) => (
                                        <tr
                                            key={row.staff_id}
                                            className="border-t border-line-soft"
                                        >
                                            <td className="py-2 text-ink">{row.name}</td>
                                            <td className="py-2 text-right font-medium tabular-nums text-ink">
                                                {formatMoney(row.total_cents)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </Card>
                </div>
            )}
            {loading ? (
                <p className="mt-4 text-xs text-muted">{strings.reports.loadingReports}</p>
            ) : null}
        </div>
    );
}

function RangeField({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
            {label}
            <input
                type="date"
                value={value}
                onChange={(e) => {
                    onChange(e.target.value);
                }}
                className="rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
        </label>
    );
}

function Card({
    title,
    subtitle,
    onDownload,
    downloading,
    children,
}: {
    title: string;
    subtitle: string;
    onDownload: () => void;
    downloading: boolean;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-lg border border-line bg-surface p-5 shadow-card">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
                    <p className="mt-0.5 text-sm text-muted">{subtitle}</p>
                </div>
                <button
                    type="button"
                    onClick={onDownload}
                    disabled={downloading}
                    className="shrink-0 rounded-md border border-line px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-bg disabled:opacity-60"
                >
                    {downloading ? strings.reports.downloading : strings.reports.downloadCsv}
                </button>
            </div>
            <div className="mt-4">{children}</div>
        </section>
    );
}

function Figure({
    label,
    cents,
    tone = "ink",
}: {
    label: string;
    cents: number;
    tone?: "ink" | "success" | "danger";
}) {
    const toneClass =
        tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-ink";
    return (
        <div className="rounded-md border border-line bg-bg p-4">
            <p className="text-sm text-muted">{label}</p>
            <p className={`mt-1 font-display text-2xl font-bold tabular-nums ${toneClass}`}>
                {formatMoney(cents)}
            </p>
        </div>
    );
}

function Skeleton() {
    return <div className="h-8 w-40 animate-pulse rounded bg-bg" />;
}
