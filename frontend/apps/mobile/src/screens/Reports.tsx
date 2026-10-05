import {
    type GstHstReport,
    type IncomeReport,
    type T4ARow,
    defaultReportRange,
    formatMoney,
    formatMoneyWithCurrency,
    formatMonthDay,
    parseTimestamp,
    paymentStatusIntent,
    reportRangeForYear,
    strings,
    useBankDeposits,
    useReportDownload,
    useRemittanceAction,
    useReports,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useState } from "react";
import { ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Button, Empty, Loading, Notice, Panel, Stat, StatusPill, Stepper } from "@clientbridge/ui";

import { api } from "../lib/api";

const c = theme.colors;

export function Reports() {
    const [year, setYear] = useState(defaultReportRange().year);
    const range = reportRangeForYear(year);
    const { income, gstHst, t4a, salesByItem, error } = useReports(api, range);
    const {
        error: dlError,
        isDownloading,
        download,
    } = useReportDownload(api, range, async (csv) => {
        await Share.share({ message: csv });
    });

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <View style={styles.yearRow}>
                <Stepper value={year} onChange={setYear} label={strings.reports.t4aYear} />
            </View>

            {dlError !== null ? <Notice tone="danger">{dlError}</Notice> : null}

            {error ? (
                <Text style={styles.muted}>{strings.reports.loadError}</Text>
            ) : (
                <>
                    <ReportPanel
                        title={strings.reports.incomeTitle}
                        subtitle={strings.reports.incomeSubtitle}
                        onDownload={() => {
                            download("income");
                        }}
                        downloading={isDownloading("income")}
                    >
                        {income === null ? <Loading inline /> : <IncomeBody income={income} />}
                    </ReportPanel>

                    <ReportPanel
                        title={strings.reports.gstTitle}
                        subtitle={strings.reports.gstSubtitleMobile}
                        onDownload={() => {
                            download("gst-hst");
                        }}
                        downloading={isDownloading("gst-hst")}
                    >
                        {gstHst === null ? <Loading inline /> : <GstBody report={gstHst} />}
                    </ReportPanel>

                    <ReportPanel
                        title={strings.reports.t4aTitle(year)}
                        subtitle={strings.reports.t4aSubtitleMobile}
                        onDownload={() => {
                            download("t4a");
                        }}
                        downloading={isDownloading("t4a")}
                    >
                        {t4a === null ? (
                            <Loading inline />
                        ) : t4a.length === 0 ? (
                            <Text style={styles.muted}>{strings.reports.noPayeeAmounts(year)}</Text>
                        ) : (
                            t4a.map((row: T4ARow) => (
                                <View key={row.staff_id} style={styles.line}>
                                    <Text style={styles.lineLabel}>{row.name}</Text>
                                    <Text style={styles.lineValue}>
                                        {formatMoney(row.total_cents)}
                                    </Text>
                                </View>
                            ))
                        )}
                    </ReportPanel>

                    <ReportPanel
                        title={strings.reports.salesByItemTitle}
                        subtitle={strings.reports.salesByItemSubtitle}
                        onDownload={() => {
                            download("sales-by-item");
                        }}
                        downloading={isDownloading("sales-by-item")}
                    >
                        {salesByItem === null ? (
                            <Loading inline />
                        ) : salesByItem.length === 0 ? (
                            <Text style={styles.muted}>{strings.reports.noItemSales}</Text>
                        ) : (
                            salesByItem.map((row) => (
                                <View key={row.item_id} style={styles.line}>
                                    <View style={styles.itemMain}>
                                        <Text style={styles.itemName} numberOfLines={1}>
                                            {row.name}
                                        </Text>
                                        <Text style={styles.itemSub}>
                                            {strings.reports.colQty}{" "}
                                            {strings.reports.qty(row.quantity)} ·{" "}
                                            {strings.reports.colTax} {formatMoney(row.tax_cents)}
                                            {row.refunded_cents > 0
                                                ? ` · ${strings.reports.colRefunded} ${formatMoney(row.refunded_cents)}`
                                                : ""}
                                        </Text>
                                    </View>
                                    <Text style={styles.lineValue}>
                                        {formatMoney(row.sales_cents)}
                                    </Text>
                                </View>
                            ))
                        )}
                    </ReportPanel>
                </>
            )}
            <BankDeposits />
        </ScrollView>
    );
}

function BankDeposits() {
    const payouts = useBankDeposits();
    return (
        <Panel title={strings.reports.bankDeposits} subtitle={strings.reports.bankDepositsSubtitle}>
            <View style={styles.cardBody}>
                {payouts.length === 0 ? (
                    <Empty message={strings.reports.noBankDeposits} />
                ) : (
                    payouts.map((row) => (
                        <View key={row.id} style={styles.deposit}>
                            <Text style={styles.lineValue}>
                                {formatMoneyWithCurrency(row.amount_cents, "CAD")}
                            </Text>
                            <StatusPill
                                status={row.status}
                                intent={paymentStatusIntent(row.status)}
                            />
                            {row.arrival_at !== null ? (
                                <Text style={styles.arrival}>
                                    {formatMonthDay(parseTimestamp(row.arrival_at))}
                                </Text>
                            ) : null}
                        </View>
                    ))
                )}
            </View>
        </Panel>
    );
}

function IncomeBody({ income }: { income: IncomeReport }) {
    return (
        <>
            <Stat label={strings.reports.gross} cents={income.gross_cents} />
            <Stat label={strings.reports.refunds} cents={income.refunds_cents} tone="danger" />
            <Stat label={strings.reports.net} cents={income.net_cents} tone="success" />
            {Object.entries(income.by_method).map(([method, cents]) => (
                <View key={method} style={styles.line}>
                    <Text style={styles.lineLabel}>{method}</Text>
                    <Text style={styles.lineValue}>{formatMoney(cents)}</Text>
                </View>
            ))}
        </>
    );
}

function GstBody({ report }: { report: GstHstReport }) {
    return (
        <>
            <Stat
                label={strings.reports.taxCollected}
                cents={report.tax_collected_cents}
                tone="success"
            />
            {report.pst_cents > 0 ? (
                <Stat label={strings.reports.pstCollected} cents={report.pst_cents} />
            ) : null}
            {report.qst_cents > 0 ? (
                <Stat label={strings.reports.qstCollected} cents={report.qst_cents} />
            ) : null}
            <Stat label={strings.reports.taxableSales} cents={report.taxable_sales_cents} />
            <View style={styles.line}>
                <Text style={styles.lineLabel}>{strings.reports.gstNumberLabel}</Text>
                <Text style={styles.lineValue}>
                    {report.gst_hst_number ?? strings.reports.notRegistered}
                </Text>
            </View>
            <Remittances />
        </>
    );
}

function Remittances() {
    const { filed, period, canRecord, busy, error, record } = useRemittanceAction(api);
    return (
        <View style={styles.remit}>
            <Text style={styles.remitTitle}>{strings.reports.remitTitle}</Text>
            {filed.length === 0 ? (
                <Text style={styles.muted}>{strings.reports.remitNone}</Text>
            ) : (
                filed.map((row) => (
                    <View key={row.id} style={styles.figure}>
                        <Text style={styles.figureLabel}>
                            {strings.reports.remitRow(row.period_start, row.period_end)}
                        </Text>
                        <Text style={styles.lineValue}>{formatMoney(row.total_cents)}</Text>
                    </View>
                ))
            )}
            {error !== null ? <Notice tone="danger">{error}</Notice> : null}
            <Button full onPress={record} busy={busy} disabled={!canRecord}>
                {busy
                    ? strings.reports.remitting
                    : strings.reports.remitAction(period.start, period.end)}
            </Button>
        </View>
    );
}

function ReportPanel({
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
        <Panel
            title={title}
            subtitle={subtitle}
            actions={
                <Button variant="outline" size="sm" onPress={onDownload} busy={downloading}>
                    {strings.reports.csv}
                </Button>
            }
        >
            <View style={styles.cardBody}>{children}</View>
        </Panel>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    center: { alignItems: "center", justifyContent: "center" },
    content: { padding: 16, gap: 14 },
    muted: { color: c.muted, fontSize: 14 },
    yearRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 20 },
    cardBody: { gap: 8 },
    figure: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    figureLabel: { color: c.muted, fontSize: 14 },
    line: {
        flexDirection: "row",
        justifyContent: "space-between",
        paddingTop: 8,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.borderSoft,
    },
    lineLabel: { color: c.inkSoft, fontSize: 14, textTransform: "capitalize" },
    lineValue: { color: c.ink, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
    itemMain: { flex: 1, marginRight: 12 },
    itemName: { color: c.inkSoft, fontSize: 14 },
    itemSub: { color: c.muted, fontSize: 12, marginTop: 2 },
    remit: {
        gap: 8,
        paddingTop: 8,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.borderSoft,
    },
    remitTitle: { color: c.ink, fontSize: 14, fontWeight: "700" },
    deposit: { flexDirection: "row", alignItems: "center", gap: 10 },
    arrival: { color: c.muted, fontSize: 12, marginLeft: "auto" },
});
