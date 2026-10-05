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
    type ReportCsvKind,
} from "@clientbridge/app-core";
import {
    Button,
    Empty,
    Loading,
    Notice,
    Panel,
    Stat,
    StatusPill,
    TextField,
} from "@clientbridge/ui";
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

            <div className="mt-6">
                <Panel>
                    <div className="flex flex-wrap items-end gap-4">
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
                </Panel>
            </div>

            {dlError !== null ? (
                <div className="mt-3">
                    <Notice tone="danger">{dlError}</Notice>
                </div>
            ) : null}

            {error ? (
                <div className="mt-6">
                    <Notice tone="danger">{strings.reports.loadError}</Notice>
                </div>
            ) : (
                <div className="mt-6 space-y-5">
                    <Panel
                        title={strings.reports.incomeTitle}
                        subtitle={strings.reports.incomeSubtitle}
                        actions={
                            <Download
                                report="income"
                                busy={isDownloading("income")}
                                onPress={download}
                            />
                        }
                    >
                        {income === null ? (
                            <Loading inline />
                        ) : (
                            <>
                                <div className="grid gap-4 sm:grid-cols-3">
                                    <Stat
                                        label={strings.reports.gross}
                                        cents={income.gross_cents}
                                    />
                                    <Stat
                                        label={strings.reports.refunds}
                                        cents={income.refunds_cents}
                                        tone="danger"
                                    />
                                    <Stat
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
                    </Panel>

                    <Panel
                        title={strings.reports.gstTitle}
                        subtitle={strings.reports.gstSubtitle}
                        actions={
                            <Download
                                report="gst-hst"
                                busy={isDownloading("gst-hst")}
                                onPress={download}
                            />
                        }
                    >
                        {gstHst === null ? (
                            <Loading inline />
                        ) : (
                            <>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <Stat
                                        label={strings.reports.taxCollected}
                                        cents={gstHst.tax_collected_cents}
                                        tone="success"
                                    />
                                    {gstHst.pst_cents > 0 ? (
                                        <Stat
                                            label={strings.reports.pstCollected}
                                            cents={gstHst.pst_cents}
                                        />
                                    ) : null}
                                    {gstHst.qst_cents > 0 ? (
                                        <Stat
                                            label={strings.reports.qstCollected}
                                            cents={gstHst.qst_cents}
                                        />
                                    ) : null}
                                    <Stat
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
                    </Panel>

                    <Panel
                        title={strings.reports.t4aTitle(range.year)}
                        subtitle={strings.reports.t4aSubtitle}
                        actions={
                            <Download report="t4a" busy={isDownloading("t4a")} onPress={download} />
                        }
                    >
                        {t4a === null ? (
                            <Loading inline />
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
                    </Panel>

                    <Panel
                        title={strings.reports.salesByItemTitle}
                        subtitle={strings.reports.salesByItemSubtitle}
                        actions={
                            <Download
                                report="sales-by-item"
                                busy={isDownloading("sales-by-item")}
                                onPress={download}
                            />
                        }
                    >
                        {salesByItem === null ? (
                            <Loading inline />
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
                    </Panel>
                </div>
            )}
            {loading ? <Loading inline label={strings.reports.loadingReports} /> : null}
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
            <div className="mt-3">
                <Panel flush>
                    {payouts.length === 0 ? (
                        <Empty message={strings.reports.noBankDeposits} />
                    ) : (
                        <div className="divide-y divide-line">
                            {payouts.map((row) => (
                                <div
                                    key={row.id}
                                    className="flex items-center gap-3 px-4 py-2.5 text-sm"
                                >
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
                </Panel>
            </div>
        </section>
    );
}

function Download({
    report,
    busy,
    onPress,
}: {
    report: ReportCsvKind;
    busy: boolean;
    onPress: (report: ReportCsvKind) => void;
}) {
    return (
        <Button
            variant="outline"
            busy={busy}
            onPress={() => {
                onPress(report);
            }}
        >
            {busy ? strings.reports.downloading : strings.reports.downloadCsv}
        </Button>
    );
}
