import {
    EXPORT_KINDS,
    type ExportKind,
    type IconName,
    REPORT_PERIODS,
    type ReportKey,
    type ReportPeriodKey,
    type ReportsView,
    formatMoney,
    spanLabel,
    strings,
    useMoneyReports,
    useReportFile,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    BarChart,
    Button,
    DetailSection,
    DetailView,
    DocTotals,
    Empty,
    KeyValueList,
    ListRow,
    LoadFailed,
    Meter,
    Modal,
    Notice,
    Panel,
    Skeleton,
    Tabs,
    ui,
} from "@clientbridge/ui";
import { useState } from "react";
import { ScrollView, Share, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";

const s = strings.reports;
const c = theme.colors;
const REPORTS: ReportKey[] = ["income", "salesByItem", "gstHst", "pst", "t4a"];
const ICONS: Record<ReportKey, IconName> = {
    income: "dollar",
    salesByItem: "tag",
    gstHst: "building",
    pst: "percent",
    t4a: "user",
};

async function shareCsv(csv: string, filename: string): Promise<void> {
    await Share.share({ title: filename, message: csv });
}

function figure(key: ReportKey, v: ReportsView): string {
    switch (key) {
        case "income":
            return formatMoney(v.netCents);
        case "salesByItem":
            return s.sold(v.unitsSold);
        case "gstHst":
            return formatMoney(v.gst.collectedCents);
        case "pst":
            return v.provincial === null ? "" : formatMoney(v.provincial.collectedCents);
        case "t4a":
            return formatMoney(v.t4aTotalCents);
    }
}

export function Reports() {
    const r = useMoneyReports(api);
    const file = useReportFile(api, r.span, shareCsv);
    const [open, setOpen] = useState<ReportKey | null>(null);
    const [packing, setPacking] = useState(false);
    const v = r.view;
    const name = (key: ExportKind): string =>
        key === "pst" && v?.provincial ? v.provincial.label : (s.library[key] ?? key);

    return (
        <View style={styles.screen}>
            <Tabs
                variant="pill"
                label={s.periodLabel}
                items={REPORT_PERIODS.map((key) => ({ key, label: s.period[key] ?? key }))}
                active={r.period}
                onSelect={(k: ReportPeriodKey) => {
                    r.setPeriod(k);
                }}
            />
            <ScrollView contentContainerStyle={styles.page}>
                <Text style={ui.note}>{s.subtitle}</Text>
                {r.load.state === "loading" ? (
                    <Skeleton variant="row" count={5} label={s.loading} />
                ) : r.load.state === "error" ? (
                    <LoadFailed
                        variant="card"
                        message={s.loadError}
                        onRetry={r.load.retry}
                        retrying={r.load.retrying}
                    />
                ) : r.load.state === "empty" || v === null ? (
                    <Empty variant="card" icon="dollar" message={s.noSales} body={s.noSalesBody} />
                ) : (
                    <>
                        <Text style={styles.caption}>{spanLabel(r.span)}</Text>
                        <Panel flush>
                            {REPORTS.map((key) => (
                                <ListRow
                                    key={key}
                                    icon={ICONS[key]}
                                    title={name(key)}
                                    detail={s.libraryHint[key]}
                                    meta={figure(key, v)}
                                    onPress={() => {
                                        setOpen(key);
                                    }}
                                />
                            ))}
                        </Panel>
                        <Button
                            full
                            variant="outline"
                            icon="mail"
                            onPress={() => {
                                setPacking(true);
                            }}
                        >
                            {s.bookkeeperPack}
                        </Button>
                    </>
                )}
            </ScrollView>

            {open !== null && v !== null ? (
                <DetailView
                    open
                    title={
                        open === "pst" && v.provincial ? s.pstTitle(v.provincial.label) : name(open)
                    }
                    subtitle={open === "t4a" ? s.t4aYear(v.t4aYear) : spanLabel(r.span)}
                    onClose={() => {
                        setOpen(null);
                    }}
                    actions={
                        <Button
                            grow
                            variant="outline"
                            busy={file.busyKind === open}
                            onPress={() => {
                                file.download(open);
                            }}
                        >
                            {s.csv}
                        </Button>
                    }
                >
                    {file.error !== null ? <Notice tone="danger">{file.error}</Notice> : null}
                    <DetailSection>
                        <ReportBody report={open} v={v} />
                    </DetailSection>
                    {open === "income" ? (
                        <DetailSection title={s.monthlyNet}>
                            <BarChart
                                label={s.monthlyNet}
                                bars={v.bars.map((b) => ({
                                    key: b.key,
                                    label: b.label,
                                    value: Math.max(0, b.netCents),
                                    valueLabel: formatMoney(b.netCents),
                                    partial: b.partial,
                                    dim: !b.inSpan,
                                }))}
                            />
                        </DetailSection>
                    ) : null}
                </DetailView>
            ) : null}

            <Modal
                open={packing}
                size="xl"
                onClose={() => {
                    setPacking(false);
                }}
            >
                <ScrollView>
                    <Text style={styles.sheetTitle}>{s.packTitle}</Text>
                    <Text style={ui.note}>{`${spanLabel(r.span)} · ${s.packMobile}`}</Text>
                    {file.error !== null ? <Notice tone="danger">{file.error}</Notice> : null}
                    <View style={styles.pack}>
                        {EXPORT_KINDS.map((kind) => (
                            <ListRow
                                key={kind}
                                title={name(kind)}
                                detail={s.packRows(v?.rows[kind] ?? 0)}
                                trailing={
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        busy={file.busyKind === kind}
                                        onPress={() => {
                                            file.download(kind);
                                        }}
                                    >
                                        {s.shareCsv}
                                    </Button>
                                }
                            />
                        ))}
                    </View>
                </ScrollView>
            </Modal>
        </View>
    );
}

function ReportBody({ report, v }: { report: ReportKey; v: ReportsView }) {
    switch (report) {
        case "income":
            return (
                <View style={styles.stack}>
                    <DocTotals
                        lines={[
                            { key: "sales", label: s.sales, cents: v.salesCents, kind: "subtotal" },
                            {
                                key: "refunds",
                                label: s.refunds,
                                cents: v.refundsCents,
                                kind: "deduction",
                            },
                            { key: "net", label: s.netSales, cents: v.netCents, kind: "total" },
                            ...v.taxLines.map((t) => ({
                                key: t.code,
                                label: t.label,
                                cents: t.cents,
                                kind: "tax" as const,
                                hint: t.rate,
                            })),
                            {
                                key: "withTax",
                                label: s.salesWithTax,
                                cents: v.salesWithTaxCents,
                                kind: "balance",
                            },
                            ...(v.tipsCents !== 0
                                ? [
                                      {
                                          key: "tips",
                                          label: s.tips,
                                          cents: v.tipsCents,
                                          kind: "subtotal" as const,
                                      },
                                  ]
                                : []),
                        ]}
                    />
                    <Text style={styles.caption}>
                        {`${s.byMethod} · ${s.received(formatMoney(v.receivedCents))}`}
                    </Text>
                    {v.methods.length === 0 ? <Text style={ui.note}>{s.noPayments}</Text> : null}
                    {v.methods.map((m) => (
                        <Meter
                            key={m.method}
                            value={Math.max(0, m.cents)}
                            max={Math.max(1, v.receivedCents)}
                            label={m.label}
                            detail={`${s.share(m.share)} · ${formatMoney(m.cents)}`}
                            labelPosition="above"
                            size="sm"
                        />
                    ))}
                </View>
            );
        case "salesByItem":
            return v.items.length === 0 ? (
                <Empty message={s.noItems} />
            ) : (
                <View>
                    {v.items.map((row) => (
                        <ListRow
                            key={row.id}
                            density="compact"
                            title={row.name}
                            detail={`${row.kind} · ${s.colQty} ${row.quantity}${
                                row.refundedCents > 0
                                    ? ` · ${s.colRefunded} ${formatMoney(row.refundedCents)}`
                                    : ""
                            }`}
                            meta={formatMoney(row.netCents)}
                        />
                    ))}
                </View>
            );
        case "gstHst":
            return (
                <View style={styles.stack}>
                    <DocTotals
                        lines={[
                            {
                                key: "101",
                                label: s.taxableSales,
                                cents: v.gst.taxableCents,
                                kind: "subtotal",
                            },
                            {
                                key: "105",
                                label: s.gstLine105(v.gst.label),
                                cents: v.gst.collectedCents,
                                kind: "balance",
                            },
                        ]}
                    />
                    <Text style={ui.note}>{s.gstNumber(v.gst.number)}</Text>
                </View>
            );
        case "pst":
            return v.provincial === null ? (
                <Empty message={s.noProvincial} />
            ) : (
                <View style={styles.stack}>
                    <DocTotals
                        lines={[
                            {
                                key: "sales",
                                label: s.provincialSales,
                                cents: v.provincial.taxableCents,
                                kind: "subtotal",
                            },
                            {
                                key: "tax",
                                label: s.taxCollected(v.provincial.label),
                                cents: v.provincial.collectedCents,
                                kind: "balance",
                                hint: v.provincial.rate,
                            },
                        ]}
                    />
                    <Text style={ui.note}>
                        {s.provincialNumber(v.provincial.label, v.provincial.number)}
                    </Text>
                </View>
            );
        case "t4a":
            return (
                <View style={styles.stack}>
                    {v.t4a.length === 0 ? (
                        <Empty message={s.noT4a} />
                    ) : (
                        <KeyValueList
                            rows={v.t4a.map((row) => ({
                                label: `${row.name} · ${s.colPayments} ${String(row.payments)}`,
                                value: formatMoney(row.totalCents),
                            }))}
                        />
                    )}
                    <Text style={ui.note}>{s.t4aNote}</Text>
                </View>
            );
    }
}

const styles = StyleSheet.create({
    screen: { flex: 1, gap: 8 },
    page: { gap: 10, padding: 16, paddingBottom: 32 },
    stack: { gap: 10 },
    pack: { marginTop: 12 },
    caption: {
        color: c.muted,
        fontSize: 12,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    sheetTitle: { fontSize: 18, fontWeight: "700", color: c.ink },
});
