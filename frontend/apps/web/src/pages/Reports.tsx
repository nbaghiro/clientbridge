import {
    type ExportKind,
    type IconName,
    type PackRequest,
    REPORT_PERIODS,
    type ReportKey,
    type ReportPeriodKey,
    type ReportsView,
    EXPORT_KINDS,
    formatMoney,
    spanLabel,
    strings,
    useBookkeeperPack,
    useMoneyReports,
    useReportFile,
} from "@clientbridge/app-core";
import {
    BarChart,
    Button,
    Checkbox,
    Choice,
    DocTotals,
    Empty,
    ListRow,
    LoadFailed,
    Meter,
    Modal,
    Notice,
    Panel,
    Skeleton,
} from "@clientbridge/ui";
import { useState } from "react";

import { api } from "../lib/api";

const s = strings.reports;
const REPORTS: ReportKey[] = ["income", "salesByItem", "gstHst", "pst", "t4a"];
const ICONS: Record<ReportKey, IconName> = {
    income: "dollar",
    salesByItem: "tag",
    gstHst: "building",
    pst: "percent",
    t4a: "user",
};

function saveFile(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

async function downloadZip(request: PackRequest, filename: string): Promise<void> {
    const res = await api.authFetch("/v1/reports/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
    });
    if (!res.ok) throw new Error(`export → ${String(res.status)}`);
    saveFile(await res.blob(), filename);
}

export function Reports() {
    const r = useMoneyReports(api);
    const file = useReportFile(api, r.span, (csv, name) => {
        saveFile(new Blob([csv], { type: "text/csv" }), name);
    });
    const pack = useBookkeeperPack(r.span, downloadZip);
    const [open, setOpen] = useState<ReportKey>("income");
    const [packing, setPacking] = useState(false);
    const ready = r.load.state === "ready";
    const v = r.view;
    const title =
        open === "pst" && v?.provincial ? s.pstTitle(v.provincial.label) : s.library[open];

    return (
        <div>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <p className="text-sm text-muted">{s.subtitle}</p>
                    <div className="mt-3">
                        <Choice<ReportPeriodKey>
                            layout="segmented"
                            label={s.periodLabel}
                            options={REPORT_PERIODS.map((key) => ({
                                key,
                                label: s.period[key] ?? key,
                            }))}
                            value={r.period}
                            onChange={r.setPeriod}
                        />
                    </div>
                </div>
                <Button
                    variant="outline"
                    icon="mail"
                    disabled={!ready}
                    onPress={() => {
                        setPacking(true);
                    }}
                >
                    {s.bookkeeperPack}
                </Button>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[240px_1fr]">
                <div className="self-start">
                    <Panel flush>
                        <nav aria-label={s.title} className="divide-y divide-line-soft">
                            {REPORTS.map((key) => (
                                <ListRow
                                    key={key}
                                    icon={ICONS[key]}
                                    intent={key === open ? "accent" : "neutral"}
                                    selected={key === open}
                                    title={
                                        key === "pst" && v?.provincial
                                            ? v.provincial.label
                                            : s.library[key]
                                    }
                                    detail={s.libraryHint[key]}
                                    onPress={() => {
                                        setOpen(key);
                                    }}
                                />
                            ))}
                        </nav>
                    </Panel>
                </div>

                <div className="print-area">
                    <Panel
                        title={title}
                        subtitle={
                            v !== null && open === "t4a" ? s.t4aYear(v.t4aYear) : spanLabel(r.span)
                        }
                        actions={
                            <>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    icon="receipt"
                                    disabled={!ready}
                                    label={s.printHint}
                                    onPress={() => {
                                        window.print();
                                    }}
                                >
                                    {s.pdf}
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={!ready}
                                    busy={file.busyKind === open}
                                    onPress={() => {
                                        file.download(open);
                                    }}
                                >
                                    {s.downloadCsv}
                                </Button>
                            </>
                        }
                    >
                        {file.done !== null ? (
                            <div className="mb-4">
                                <Notice tone="success">{file.done}</Notice>
                            </div>
                        ) : null}
                        {file.error !== null ? (
                            <div className="mb-4">
                                <Notice tone="danger">{file.error}</Notice>
                            </div>
                        ) : null}
                        {r.load.state === "loading" ? (
                            <Skeleton variant="line" count={6} label={s.loading} />
                        ) : r.load.state === "error" ? (
                            <LoadFailed
                                message={s.loadError}
                                onRetry={r.load.retry}
                                retrying={r.load.retrying}
                            />
                        ) : r.load.state === "empty" || v === null ? (
                            <Empty icon="dollar" message={s.noSales} body={s.noSalesBody} />
                        ) : (
                            <ReportBody report={open} v={v} />
                        )}
                    </Panel>
                </div>
            </div>

            <Modal
                open={packing}
                size="lg"
                onClose={() => {
                    setPacking(false);
                }}
            >
                <h2 className="font-display text-lg font-bold text-ink">{s.packTitle}</h2>
                <p className="mt-1 text-sm text-muted">{`${spanLabel(r.span)} · ${s.packSubtitle}`}</p>
                <div className="mt-5 space-y-5">
                    <div>
                        <p className="text-sm font-medium text-ink-soft">{s.packIncluded}</p>
                        <ul className="mt-2 divide-y divide-line-soft rounded-md border border-line">
                            {EXPORT_KINDS.map((kind) => (
                                <PackRow
                                    key={kind}
                                    kind={kind}
                                    v={v}
                                    checked={pack.chosen.includes(kind)}
                                    onToggle={() => {
                                        pack.toggle(kind);
                                    }}
                                />
                            ))}
                        </ul>
                    </div>
                    {pack.error !== null ? <Notice tone="danger">{pack.error}</Notice> : null}
                    {pack.done ? (
                        <Notice tone="success" banner>
                            {s.packDone}
                        </Notice>
                    ) : null}
                    <p className="text-xs text-muted">{s.packEmailLater}</p>
                    <Button busy={pack.busy} onPress={pack.download}>
                        {pack.busy ? s.packWorking : s.packDownload}
                    </Button>
                </div>
            </Modal>
        </div>
    );
}

function PackRow({
    kind,
    v,
    checked,
    onToggle,
}: {
    kind: ExportKind;
    v: ReportsView | null;
    checked: boolean;
    onToggle: () => void;
}) {
    const name = kind === "pst" && v?.provincial ? v.provincial.label : (s.library[kind] ?? kind);
    return (
        <li className="flex items-center gap-3 px-3.5 py-3">
            <Checkbox label={name} hideLabel value={checked} onChange={onToggle} />
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{name}</span>
                <span className="block truncate text-xs text-muted">{s.libraryHint[kind]}</span>
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted">
                {s.packRows(v?.rows[kind] ?? 0)}
            </span>
        </li>
    );
}

const th = "pb-2 text-xs font-semibold uppercase tracking-wide text-muted";
const td = "border-t border-line-soft py-2.5";

function ReportBody({ report, v }: { report: ReportKey; v: ReportsView }) {
    switch (report) {
        case "income":
            return <IncomeBody v={v} />;
        case "salesByItem":
            return v.items.length === 0 ? (
                <Empty message={s.noItems} />
            ) : (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left">
                            <th className={th}>{s.colItem}</th>
                            <th className={`${th} hidden xl:table-cell`}>{s.colKind}</th>
                            <th className={`${th} pl-4 text-right`}>{s.colQty}</th>
                            <th className={`${th} pl-4 text-right`}>{s.colSales}</th>
                            <th className={`${th} pl-4 text-right`}>{s.colRefunded}</th>
                            <th className={`${th} pl-4 text-right`}>{s.colNet}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {v.items.map((row) => (
                            <tr key={row.id}>
                                <td className={`${td} pr-3 text-ink`}>{row.name}</td>
                                <td className={`${td} hidden text-muted xl:table-cell`}>
                                    {row.kind}
                                </td>
                                <td className={`${td} pl-4 text-right tabular-nums text-ink-soft`}>
                                    {row.quantity}
                                </td>
                                <td className={`${td} pl-4 text-right tabular-nums text-ink-soft`}>
                                    {formatMoney(row.salesCents)}
                                </td>
                                <td className={`${td} pl-4 text-right tabular-nums text-muted`}>
                                    {row.refundedCents > 0
                                        ? `−${formatMoney(row.refundedCents)}`
                                        : strings.clients.dash}
                                </td>
                                <td
                                    className={`${td} pl-4 text-right font-medium tabular-nums text-ink`}
                                >
                                    {formatMoney(row.netCents)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            );
        case "gstHst":
            return (
                <div className="space-y-3">
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
                    <p className="text-xs text-muted">{s.gstNumber(v.gst.number)}</p>
                </div>
            );
        case "pst":
            return v.provincial === null ? (
                <Empty message={s.noProvincial} />
            ) : (
                <div className="space-y-3">
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
                    <p className="text-xs text-muted">
                        {s.provincialNumber(v.provincial.label, v.provincial.number)}
                    </p>
                </div>
            );
        case "t4a":
            return (
                <div className="space-y-3">
                    {v.t4a.length === 0 ? (
                        <Empty message={s.noT4a} />
                    ) : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left">
                                    <th className={th}>{s.colPayee}</th>
                                    <th className={`${th} text-right`}>{s.colPayments}</th>
                                    <th className={`${th} text-right`}>{s.colPaid}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {v.t4a.map((row) => (
                                    <tr key={row.staffId}>
                                        <td className={`${td} text-ink`}>{row.name}</td>
                                        <td
                                            className={`${td} pl-4 text-right tabular-nums text-ink-soft`}
                                        >
                                            {row.payments}
                                        </td>
                                        <td
                                            className={`${td} pl-4 text-right font-medium tabular-nums text-ink`}
                                        >
                                            {formatMoney(row.totalCents)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    <p className="text-xs leading-relaxed text-muted">{s.t4aNote}</p>
                </div>
            );
    }
}

function IncomeBody({ v }: { v: ReportsView }) {
    return (
        <div className="space-y-8">
            <div className="grid gap-8 xl:grid-cols-2">
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
                <div>
                    <div className="flex items-baseline justify-between">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                            {s.byMethod}
                        </h3>
                        <span className="text-xs tabular-nums text-muted">
                            {s.received(formatMoney(v.receivedCents))}
                        </span>
                    </div>
                    {v.methods.length === 0 ? (
                        <p className="mt-3 text-sm text-muted">{s.noPayments}</p>
                    ) : (
                        <ul className="mt-3 space-y-3">
                            {v.methods.map((m) => (
                                <li key={m.method}>
                                    <Meter
                                        value={Math.max(0, m.cents)}
                                        max={Math.max(1, v.receivedCents)}
                                        label={m.label}
                                        detail={`${s.share(m.share)} · ${formatMoney(m.cents)}`}
                                        labelPosition="above"
                                        size="sm"
                                    />
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
            <div className="border-t border-line-soft pt-5">
                <div className="mb-4 flex items-baseline justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                        {s.monthlyNet}
                    </h3>
                    <span className="text-xs text-muted">{s.monthlyNetHint}</span>
                </div>
                <BarChart
                    label={s.monthlyNet}
                    bars={v.bars.map((b) => ({
                        key: b.key,
                        label: b.label,
                        value: Math.max(0, b.netCents),
                        valueLabel: b.partial
                            ? `${formatMoney(b.netCents)} ${s.soFar}`
                            : formatMoney(b.netCents),
                        partial: b.partial,
                        dim: !b.inSpan,
                    }))}
                />
            </div>
        </div>
    );
}
