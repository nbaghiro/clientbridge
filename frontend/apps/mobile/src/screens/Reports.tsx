import {
    type GstHstReport,
    type IncomeReport,
    type T4ARow,
    canManagePayments,
    defaultReportRange,
    formatMoney,
    reportRangeForYear,
    strings,
    useReportDownload,
    useReports,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { api } from "../lib/api";
import { useRole } from "../lib/auth";

const c = theme.colors;

export function ReportsScreen() {
    const role = useRole();

    if (!canManagePayments(role)) {
        return (
            <View style={[styles.screen, styles.center]}>
                <Text style={styles.muted}>{strings.reports.accessRestricted}</Text>
            </View>
        );
    }
    return <ReportsBody />;
}

function ReportsBody() {
    const [year, setYear] = useState(defaultReportRange().year);
    const range = reportRangeForYear(year);
    const { income, gstHst, t4a, error } = useReports(api, range);
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
                <Pressable
                    style={styles.step}
                    onPress={() => {
                        setYear((y) => y - 1);
                    }}
                >
                    <Text style={styles.stepText}>−</Text>
                </Pressable>
                <Text style={styles.year}>{year}</Text>
                <Pressable
                    style={styles.step}
                    onPress={() => {
                        setYear((y) => y + 1);
                    }}
                >
                    <Text style={styles.stepText}>+</Text>
                </Pressable>
            </View>

            {dlError !== null ? <Text style={styles.error}>{dlError}</Text> : null}

            {error ? (
                <Text style={styles.muted}>{strings.reports.loadError}</Text>
            ) : (
                <>
                    <Card
                        title={strings.reports.incomeTitle}
                        subtitle={strings.reports.incomeSubtitle}
                        onDownload={() => {
                            download("income");
                        }}
                        downloading={isDownloading("income")}
                    >
                        {income === null ? <Loading /> : <IncomeBody income={income} />}
                    </Card>

                    <Card
                        title={strings.reports.gstTitle}
                        subtitle={strings.reports.gstSubtitleMobile}
                        onDownload={() => {
                            download("gst-hst");
                        }}
                        downloading={isDownloading("gst-hst")}
                    >
                        {gstHst === null ? <Loading /> : <GstBody report={gstHst} />}
                    </Card>

                    <Card
                        title={strings.reports.t4aTitle(year)}
                        subtitle={strings.reports.t4aSubtitleMobile}
                        onDownload={() => {
                            download("t4a");
                        }}
                        downloading={isDownloading("t4a")}
                    >
                        {t4a === null ? (
                            <Loading />
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
                    </Card>
                </>
            )}
        </ScrollView>
    );
}

function IncomeBody({ income }: { income: IncomeReport }) {
    return (
        <>
            <Figure label={strings.reports.gross} cents={income.gross_cents} />
            <Figure label={strings.reports.refunds} cents={income.refunds_cents} tone="danger" />
            <Figure label={strings.reports.net} cents={income.net_cents} tone="success" />
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
            <Figure
                label={strings.reports.taxCollected}
                cents={report.tax_collected_cents}
                tone="success"
            />
            {report.pst_cents > 0 ? (
                <Figure label={strings.reports.pstCollected} cents={report.pst_cents} />
            ) : null}
            {report.qst_cents > 0 ? (
                <Figure label={strings.reports.qstCollected} cents={report.qst_cents} />
            ) : null}
            <Figure label={strings.reports.taxableSales} cents={report.taxable_sales_cents} />
            <View style={styles.line}>
                <Text style={styles.lineLabel}>{strings.reports.gstNumberLabel}</Text>
                <Text style={styles.lineValue}>
                    {report.gst_hst_number ?? strings.reports.notRegistered}
                </Text>
            </View>
        </>
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
    const color = tone === "success" ? c.success : tone === "danger" ? c.danFg : c.ink;
    return (
        <View style={styles.figure}>
            <Text style={styles.figureLabel}>{label}</Text>
            <Text style={[styles.figureValue, { color }]}>{formatMoney(cents)}</Text>
        </View>
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
        <View style={styles.card}>
            <View style={styles.cardHead}>
                <View style={styles.cardHeadText}>
                    <Text style={styles.cardTitle}>{title}</Text>
                    <Text style={styles.cardSub}>{subtitle}</Text>
                </View>
                <Pressable style={styles.csv} onPress={onDownload} disabled={downloading}>
                    {downloading ? (
                        <ActivityIndicator color={c.inkSoft} size="small" />
                    ) : (
                        <Text style={styles.csvText}>{strings.reports.csv}</Text>
                    )}
                </Pressable>
            </View>
            <View style={styles.cardBody}>{children}</View>
        </View>
    );
}

function Loading() {
    return <ActivityIndicator color={c.muted} style={styles.loading} />;
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    center: { alignItems: "center", justifyContent: "center" },
    content: { padding: 16, gap: 14 },
    muted: { color: c.muted, fontSize: 14 },
    error: { color: c.danFg, fontSize: 13 },
    yearRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 20 },
    step: {
        width: 40,
        height: 40,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        alignItems: "center",
        justifyContent: "center",
    },
    stepText: { color: c.ink, fontSize: 22, fontWeight: "600" },
    year: { color: c.ink, fontSize: 22, fontWeight: "700", minWidth: 72, textAlign: "center" },
    card: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        padding: 16,
    },
    cardHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
    cardHeadText: { flex: 1 },
    cardTitle: { color: c.ink, fontSize: 16, fontWeight: "700" },
    cardSub: { color: c.muted, fontSize: 13, marginTop: 2 },
    csv: {
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        minWidth: 52,
        alignItems: "center",
    },
    csvText: { color: c.inkSoft, fontSize: 13, fontWeight: "600" },
    cardBody: { marginTop: 12, gap: 8 },
    figure: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    figureLabel: { color: c.muted, fontSize: 14 },
    figureValue: { fontSize: 18, fontWeight: "700", fontVariant: ["tabular-nums"] },
    line: {
        flexDirection: "row",
        justifyContent: "space-between",
        paddingTop: 8,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.borderSoft,
    },
    lineLabel: { color: c.inkSoft, fontSize: 14, textTransform: "capitalize" },
    lineValue: { color: c.ink, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
    loading: { alignSelf: "flex-start" },
});
