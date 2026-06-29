import {
    type GstHstReport,
    type IncomeReport,
    type ReportCsvKind,
    type T4ARow,
    canManagePayments,
    defaultReportRange,
    downloadReportCsv,
    formatMoney,
    reportRangeForYear,
    useAsyncAction,
    useCurrentRole,
    useReports,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useEffect, useState } from "react";
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
import { getTokens } from "../lib/auth";

const c = theme.colors;

export function ReportsScreen() {
    const [token, setToken] = useState<string | null>(null);
    useEffect(() => {
        void getTokens().then((t) => {
            setToken(t?.access_token ?? null);
        });
    }, []);
    const role = useCurrentRole(token);

    if (!canManagePayments(role)) {
        return (
            <View style={[styles.screen, styles.center]}>
                <Text style={styles.muted}>Reports are available to owners and admins.</Text>
            </View>
        );
    }
    return <ReportsBody />;
}

function ReportsBody() {
    const [year, setYear] = useState(defaultReportRange().year);
    const range = reportRangeForYear(year);
    const { income, gstHst, t4a, error } = useReports(api, range);
    const { busy, error: dlError, run } = useAsyncAction();
    const [downloading, setDownloading] = useState<ReportCsvKind | null>(null);

    const download = (kind: ReportCsvKind): void => {
        setDownloading(kind);
        void run(
            async () => {
                const csv = await downloadReportCsv(api, kind, range);
                await Share.share({ message: csv });
            },
            { errorMessage: "Couldn't share the CSV. Please try again." },
        );
    };

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
                <Text style={styles.muted}>Couldn’t load your reports.</Text>
            ) : (
                <>
                    <Card
                        title="Income"
                        subtitle="Payments received, net of refunds"
                        onDownload={() => {
                            download("income");
                        }}
                        downloading={busy && downloading === "income"}
                    >
                        {income === null ? <Loading /> : <IncomeBody income={income} />}
                    </Card>

                    <Card
                        title="GST/HST"
                        subtitle="Tax collected on paid invoices"
                        onDownload={() => {
                            download("gst-hst");
                        }}
                        downloading={busy && downloading === "gst-hst"}
                    >
                        {gstHst === null ? <Loading /> : <GstBody report={gstHst} />}
                    </Card>

                    <Card
                        title={`T4A — ${year}`}
                        subtitle="Amounts paid to staff payees"
                        onDownload={() => {
                            download("t4a");
                        }}
                        downloading={busy && downloading === "t4a"}
                    >
                        {t4a === null ? (
                            <Loading />
                        ) : t4a.length === 0 ? (
                            <Text style={styles.muted}>No payee amounts for {year}.</Text>
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
            <Figure label="Gross" cents={income.gross_cents} />
            <Figure label="Refunds" cents={income.refunds_cents} tone="danger" />
            <Figure label="Net" cents={income.net_cents} tone="success" />
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
            <Figure label="Tax collected" cents={report.tax_collected_cents} tone="success" />
            <Figure label="Taxable sales" cents={report.taxable_sales_cents} />
            <View style={styles.line}>
                <Text style={styles.lineLabel}>GST/HST number</Text>
                <Text style={styles.lineValue}>{report.gst_hst_number ?? "Not registered"}</Text>
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
                        <Text style={styles.csvText}>CSV</Text>
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
