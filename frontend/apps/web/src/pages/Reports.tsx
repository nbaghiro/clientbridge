import {
    type ReportRange,
    type T4ARow,
    defaultReportRange,
    formatMoney,
    formatMoneyWithCurrency,
    formatMonthDay,
    parseTimestamp,
    paymentStatusIntent,
    strings,
    useReportDownload,
    useRemittanceAction,
    useBankDeposits,
    useReports,
} from "@clientbridge/app-core";
import { Button, Notice, StatusPill, TextField } from "@clientbridge/ui";
import { useState } from "react";

import { api } from "../lib/api";

export function Reports() {
    const [range, setRange] = useState<ReportRange>(defaultReportRange());
    const { income, gstHst, t4a, salesByItem, loading, error } = useReports(api, range);
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
        <div>
            <p className="text-sm text-muted">{strings.reports.subtitle}</p>

            <div className="mt-6 flex flex-wrap items-end gap-4 rounded-lg border border-line bg-surface p-4">
                <TextField
                    label={strings.reports.rangeFrom}
                    type="date"
                    width="auto"
                    value={range.start}
                    onChange={(start) => {
                        setRange((r) => ({ ...r, start }));
                    }}
                />
                <TextField
                    label={strings.reports.rangeTo}
                    type="date"
                    width="auto"
                    value={range.end}
                    onChange={(end) => {
                        setRange((r) => ({ ...r, end }));
                    }}
                />
                <TextField
                    label={strings.reports.t4aYear}
                    type="number"
                    width="narrow"
                    value={String(range.year)}
                    onChange={(v) => {
                        setRange((r) => ({ ...r, year: Number(v) || r.year }));
                    }}
                />
            </div>

            {dlError !== null ? (
                <div className="mt-3">
                    <Notice tone="danger">{dlError}</Notice>
                </div>
            ) : null}

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
                                    {gstHst.pst_cents > 0 ? (
                                        <Figure
                                            label={strings.reports.pstCollected}
                                            cents={gstHst.pst_cents}
                                        />
                                    ) : null}
                                    {gstHst.qst_cents > 0 ? (
                                        <Figure
                                            label={strings.reports.qstCollected}
                                            cents={gstHst.qst_cents}
                                        />
                                    ) : null}
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
                                <Remittances />
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

                    <Card
                        title={strings.reports.salesByItemTitle}
                        subtitle={strings.reports.salesByItemSubtitle}
                        onDownload={() => {
                            download("sales-by-item");
                        }}
                        downloading={isDownloading("sales-by-item")}
                    >
                        {salesByItem === null ? (
                            <Skeleton />
                        ) : salesByItem.length === 0 ? (
                            <p className="text-sm text-muted">{strings.reports.noItemSales}</p>
                        ) : (
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-xs uppercase tracking-wide text-muted">
                                        <th className="pb-2 font-semibold">
                                            {strings.reports.colItem}
                                        </th>
                                        <th className="pb-2 text-right font-semibold">
                                            {strings.reports.colQty}
                                        </th>
                                        <th className="pb-2 text-right font-semibold">
                                            {strings.reports.colSales}
                                        </th>
                                        <th className="pb-2 text-right font-semibold">
                                            {strings.reports.colTax}
                                        </th>
                                        <th className="pb-2 text-right font-semibold">
                                            {strings.reports.colRefunded}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {salesByItem.map((row) => (
                                        <tr key={row.item_id} className="border-t border-line-soft">
                                            <td className="py-2 text-ink">{row.name}</td>
                                            <td className="py-2 text-right tabular-nums text-ink-soft">
                                                {strings.reports.qty(row.quantity)}
                                            </td>
                                            <td className="py-2 text-right font-medium tabular-nums text-ink">
                                                {formatMoney(row.sales_cents)}
                                            </td>
                                            <td className="py-2 text-right tabular-nums text-ink-soft">
                                                {formatMoney(row.tax_cents)}
                                            </td>
                                            <td className="py-2 text-right tabular-nums text-ink-soft">
                                                {formatMoney(row.refunded_cents)}
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
            <BankDeposits />
        </div>
    );
}

function Remittances() {
    const { filed, period, canRecord, busy, error, record } = useRemittanceAction(api);
    return (
        <div className="mt-4 border-t border-line-soft pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-ink">{strings.reports.remitTitle}</h3>
                <Button onPress={record} busy={busy} disabled={!canRecord}>
                    {busy
                        ? strings.reports.remitting
                        : strings.reports.remitAction(period.start, period.end)}
                </Button>
            </div>
            {error !== null ? <Notice tone="danger">{error}</Notice> : null}
            {filed.length === 0 ? (
                <p className="mt-2 text-sm text-muted">{strings.reports.remitNone}</p>
            ) : (
                <ul className="mt-2 divide-y divide-line-soft text-sm">
                    {filed.map((row) => (
                        <li key={row.id} className="flex justify-between py-2">
                            <span className="text-ink">
                                {strings.reports.remitRow(row.period_start, row.period_end)}
                            </span>
                            <span className="font-medium tabular-nums text-ink">
                                {formatMoney(row.total_cents)}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function BankDeposits() {
    const payouts = useBankDeposits();
    return (
        <section className="mt-8">
            <h2 className="font-display text-lg font-semibold text-ink">
                {strings.reports.bankDeposits}
            </h2>
            <p className="mt-0.5 text-sm text-muted">{strings.reports.bankDepositsSubtitle}</p>
            {payouts.length === 0 ? (
                <p className="mt-2 text-sm text-muted">{strings.reports.noBankDeposits}</p>
            ) : (
                <div className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface shadow-card">
                    {payouts.map((row) => (
                        <div key={row.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                            <span className="font-medium tabular-nums text-ink">
                                {formatMoneyWithCurrency(row.amount_cents, "CAD")}
                            </span>
                            <StatusPill
                                status={row.status}
                                intent={paymentStatusIntent(row.status)}
                            />
                            {row.arrival_at !== null ? (
                                <span className="ml-auto shrink-0 text-xs text-muted">
                                    {formatMonthDay(parseTimestamp(row.arrival_at))}
                                </span>
                            ) : null}
                        </div>
                    ))}
                </div>
            )}
        </section>
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
                <Button variant="outline" onPress={onDownload} busy={downloading}>
                    {downloading ? strings.reports.downloading : strings.reports.downloadCsv}
                </Button>
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
    return <div className="h-8 w-40 animate-pulse rounded-base bg-bg" />;
}
