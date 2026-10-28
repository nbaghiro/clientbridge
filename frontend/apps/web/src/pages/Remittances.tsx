import {
    type FilingForm,
    type FilingPeriod,
    type TaxFamily,
    type TaxFilings,
    filingStatusIntent,
    filingWhen,
    formatMoney,
    formatShortDay,
    strings,
    useFilingForm,
    useReportFile,
    useTaxFilings,
    formatParts,
    BUSINESS_CURRENCY,
    useBusinessZone,
    currencyAffix,
    smallSupplierLimit,
} from "@clientbridge/app-core";
import {
    Button,
    Choice,
    DocTotals,
    Empty,
    Icon,
    LoadFailed,
    Modal,
    Notice,
    Panel,
    Skeleton,
    StatusPill,
    TextField,
    DateField,
} from "@clientbridge/ui";
import { useState } from "react";

import { api } from "../lib/api";
import { useOpenLink } from "../lib/links";

const s = strings.remittances;

function saveCsv(csv: string, filename: string): void {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export function Remittances() {
    const zone = useBusinessZone();
    const t = useTaxFilings(api);
    const due = t.nextDue;
    const [recording, setRecording] = useState<FilingPeriod | null>(null);
    const [flash, setFlash] = useState<string | null>(null);
    const openLink = useOpenLink();
    const csv = useReportFile(
        api,
        due === null ? { start: "", end: "" } : { start: due.start, end: due.end },
        saveCsv,
    );

    if (t.load.state === "loading")
        return (
            <div className="space-y-6">
                <Skeleton variant="stat" count={2} columns={2} label={s.loading} />
                <Skeleton variant="row" count={4} label={s.loading} />
            </div>
        );
    if (t.load.state === "error")
        return (
            <LoadFailed
                variant="card"
                message={s.loadError}
                onRetry={t.load.retry}
                retrying={t.load.retrying}
            />
        );
    if (t.taxOff || (!t.registered && t.periods.length === 0))
        return (
            <Empty
                variant="card"
                icon="building"
                message={strings.business.getSetUp.tasks.tax.label}
                body={s.notRegistered(smallSupplierLimit())}
                actions={
                    <Button
                        size="sm"
                        onPress={() => {
                            openLink("taxes");
                        }}
                    >
                        {strings.business.getSetUp.start}
                    </Button>
                }
            />
        );
    if (t.load.state === "empty")
        return (
            <Empty variant="card" icon="building" message={s.noPeriods} body={s.noPeriodsBody} />
        );

    return (
        <div>
            <p className="text-sm text-muted">
                {t.provincialLabel === null
                    ? s.subtitle(t.federalLabel)
                    : s.subtitleWithProvince(t.federalLabel, t.provincialLabel)}
            </p>
            <div className="mt-5 space-y-5">
                {flash !== null ? (
                    <Notice tone="success" banner>
                        {flash}
                    </Notice>
                ) : null}
                {csv.done !== null ? (
                    <Notice tone="success" banner>
                        {csv.done}
                    </Notice>
                ) : null}
                <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
                    <Panel>
                        <p className="text-sm text-muted">{s.owed}</p>
                        <p className="mt-1 font-display text-4xl font-bold tabular-nums text-ink">
                            {formatMoney(t.federalSetAsideCents, BUSINESS_CURRENCY)}
                        </p>
                        <p className="mt-1 text-sm text-muted">{s.owedHint}</p>
                        <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted">
                            {s.breakdown}
                        </h3>
                        <ul className="mt-2 divide-y divide-line-soft">
                            {t.unfiled.map((p) => (
                                <li key={p.key} className="flex items-center gap-3 py-3">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium text-ink">{p.title}</p>
                                        <p className="text-xs text-muted">{p.span}</p>
                                    </div>
                                    <FilingPill p={p} />
                                    <span className="w-24 text-right text-sm font-semibold tabular-nums text-ink">
                                        {formatMoney(p.federalCents, BUSINESS_CURRENCY)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        {t.provincialLabel !== null ? (
                            <div className="mt-3 flex items-center gap-3 rounded-md bg-bg px-4 py-3 text-sm">
                                <span className="text-muted">
                                    {s.provincialOwed(t.provincialLabel)}
                                </span>
                                <span className="text-xs text-muted">{s.provincialOwedHint}</span>
                                <span className="ml-auto font-semibold tabular-nums text-ink">
                                    {formatMoney(t.provincialSetAsideCents, BUSINESS_CURRENCY)}
                                </span>
                            </div>
                        ) : null}
                    </Panel>

                    {due !== null ? (
                        <Panel className="border-warn-bg bg-warn-bg/50 shadow-none">
                            <div className="flex items-center gap-2 text-warn-fg">
                                <Icon name="clock" size={18} />
                                <span className="text-sm font-semibold">
                                    {filingWhen(due, zone)}
                                </span>
                            </div>
                            <p className="mt-3 font-display text-lg font-bold text-ink">
                                {due.title}
                            </p>
                            <p className="text-sm text-ink-soft">{due.span}</p>
                            <dl className="mt-4 space-y-1.5 text-sm">
                                <div className="flex justify-between">
                                    <dt className="text-muted">{t.federalLabel}</dt>
                                    <dd className="tabular-nums text-ink">
                                        {formatMoney(due.federalCents, BUSINESS_CURRENCY)}
                                    </dd>
                                </div>
                                {t.provincialLabel !== null ? (
                                    <div className="flex justify-between">
                                        <dt className="text-muted">{t.provincialLabel}</dt>
                                        <dd className="tabular-nums text-ink">
                                            {formatMoney(due.provincialCents, BUSINESS_CURRENCY)}
                                        </dd>
                                    </div>
                                ) : null}
                            </dl>
                            <div className="flex flex-wrap gap-2 pt-2">
                                <Button
                                    onPress={() => {
                                        setFlash(null);
                                        setRecording(due);
                                    }}
                                >
                                    {s.recordFiled}
                                </Button>
                                <Button
                                    variant="outline"
                                    busy={csv.busyKind === "gstHst"}
                                    onPress={() => {
                                        csv.download("gstHst");
                                    }}
                                >
                                    {s.downloadCsv}
                                </Button>
                            </div>
                            {t.reminderOn !== null ? (
                                <p className="mt-3 text-xs text-muted">
                                    {s.reminder(formatShortDay(t.reminderOn, zone))}
                                </p>
                            ) : null}
                        </Panel>
                    ) : null}
                </div>

                <Panel flush title={s.history}>
                    {t.filed.length === 0 ? (
                        <p className="px-4 py-6 text-sm text-muted">{s.noHistory}</p>
                    ) : (
                        <table className="w-full text-sm">
                            <tbody>
                                {t.filed.map((p) => (
                                    <tr
                                        key={p.key}
                                        className="border-b border-line-soft last:border-0"
                                    >
                                        <td className="px-4 py-3">
                                            <p className="font-medium text-ink">{p.title}</p>
                                            <p className="text-xs text-muted">{p.span}</p>
                                        </td>
                                        <td className="px-4 py-3 text-ink-soft">
                                            {filingWhen(p, zone)}
                                        </td>
                                        <td className="hidden px-4 py-3 font-mono text-xs text-muted xl:table-cell">
                                            {p.federalReturn?.confirmation ?? ""}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <p className="font-medium tabular-nums text-ink">
                                                {formatMoney(
                                                    p.federalReturn?.paid_cents ?? 0,
                                                    BUSINESS_CURRENCY,
                                                )}
                                            </p>
                                            {t.provincialLabel !== null && p.provincialReturn ? (
                                                <p className="text-xs tabular-nums text-muted">
                                                    {strings.common.labelValue(
                                                        t.provincialLabel,
                                                        formatMoney(
                                                            p.provincialReturn.paid_cents,
                                                            BUSINESS_CURRENCY,
                                                        ),
                                                    )}
                                                </p>
                                            ) : null}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </Panel>
            </div>

            {recording !== null ? (
                <RecordReturn
                    period={recording}
                    t={t}
                    onClose={() => {
                        setRecording(null);
                    }}
                    onDone={(family) => {
                        setRecording(null);
                        setFlash(
                            s.recorded(
                                recording.title,
                                family === "federal"
                                    ? s.familyFor(t.federalLabel)
                                    : s.familyFor(t.provincialLabel ?? ""),
                            ),
                        );
                        t.refresh();
                    }}
                />
            ) : null}
        </div>
    );
}

function FilingPill({ p }: { p: FilingPeriod }) {
    return <StatusPill status={s.status[p.status]} intent={filingStatusIntent(p.status)} />;
}

function RecordReturn({
    period,
    t,
    onClose,
    onDone,
}: {
    period: FilingPeriod;
    t: TaxFilings;
    onClose: () => void;
    onDone: (family: TaxFamily) => void;
}) {
    const zone = useBusinessZone();
    const form = useFilingForm(api, period, onDone);
    return (
        <Modal variant="drawer" open size="lg" onClose={onClose}>
            <h2 className="font-display text-lg font-bold text-ink">
                {s.recordTitle(period.title)}
            </h2>
            <p className="mt-1 text-sm text-muted">
                {formatParts([period.span, s.dueOn(formatShortDay(period.due, zone))])}
            </p>
            <div className="mt-5 space-y-5">
                {form.families.length === 0 ? (
                    <Notice tone="success">{s.nothingToFile}</Notice>
                ) : (
                    <>
                        {form.families.length > 1 ? (
                            <Choice<TaxFamily>
                                layout="segmented"
                                label={s.whichReturn}
                                options={form.families.map((f) => ({
                                    key: f,
                                    label: s.familyFor(
                                        f === "federal"
                                            ? t.federalLabel
                                            : (t.provincialLabel ?? ""),
                                    ),
                                }))}
                                value={form.family}
                                onChange={form.setFamily}
                            />
                        ) : null}
                        <Worksheet period={period} form={form} t={t} />
                        <FilingFields form={form} t={t} />
                    </>
                )}
            </div>
        </Modal>
    );
}

function Worksheet({ period, form, t }: { period: FilingPeriod; form: FilingForm; t: TaxFilings }) {
    if (form.family === "provincial") {
        const code = t.provincialLabel ?? "";
        return (
            <Panel title={s.provincialWorksheet(code)} subtitle={s.provincialWorksheetHint}>
                <DocTotals
                    currency={BUSINESS_CURRENCY}
                    lines={[
                        {
                            key: "sales",
                            label: s.provincialSales,
                            cents: period.provincialTaxableCents,
                            kind: "subtotal",
                        },
                        {
                            key: "tax",
                            label: s.provincialCollected(code),
                            cents: period.provincialCents,
                            kind: "balance",
                            hint: t.provincialRate,
                        },
                    ]}
                />
            </Panel>
        );
    }
    return (
        <Panel title={s.worksheet} subtitle={formatParts([period.span, s.worksheetHint])}>
            <DocTotals
                currency={BUSINESS_CURRENCY}
                lines={[
                    {
                        key: "101",
                        label: s.taxableSales,
                        cents: period.taxableCents,
                        kind: "subtotal",
                    },
                    {
                        key: "105",
                        label: s.collected(t.federalLabel),
                        cents: period.federalCents,
                        kind: "tax",
                    },
                    { key: "108", label: s.itcLine, cents: form.itcCents, kind: "credit" },
                    { key: "109", label: s.netLine, cents: form.netCents, kind: "balance" },
                ]}
            />
        </Panel>
    );
}

function FilingFields({ form, t }: { form: FilingForm; t: TaxFilings }) {
    const zone = useBusinessZone();
    const federal = form.family === "federal";
    return (
        <div className="space-y-4">
            {federal ? (
                <TextField
                    label={s.itcField}
                    hint={s.itcHint}
                    {...currencyAffix(BUSINESS_CURRENCY)}
                    type="number"
                    placeholder="0.00"
                    value={form.itc}
                    onChange={form.setItc}
                />
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                    label={federal ? s.confirmationField : s.provincialConfirmationField}
                    value={form.confirmation}
                    onChange={form.setConfirmation}
                />
                <DateField
                    zone={zone}
                    label={s.filedOnField}
                    value={form.filedOn}
                    onChange={form.setFiledOn}
                />
            </div>
            <DocTotals
                currency={BUSINESS_CURRENCY}
                density="compact"
                lines={[
                    {
                        key: "paid",
                        label: formatParts([
                            s.paid,
                            federal ? t.federalLabel : (t.provincialLabel ?? ""),
                        ]),
                        cents: form.netCents,
                        kind: "balance",
                    },
                ]}
            />
            {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
            <p className="text-xs text-muted">{s.recordHint}</p>
            <Button busy={form.busy} onPress={form.submit}>
                {form.busy ? s.recording : s.record}
            </Button>
        </div>
    );
}
