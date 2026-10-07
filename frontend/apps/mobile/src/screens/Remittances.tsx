import {
    type FilingPeriod,
    type TaxFamily,
    type TaxFilings,
    filingStatusIntent,
    filingWhen,
    formatMoney,
    formatShortDay,
    strings,
    useFilingForm,
    useTaxFilings,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Button,
    Choice,
    DocTotals,
    Empty,
    Icon,
    ListRow,
    LoadFailed,
    Modal,
    Notice,
    Panel,
    Skeleton,
    StatusPill,
    TextField,
    ui,
    DateField,
} from "@clientbridge/ui";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";

const s = strings.remittances;
const c = theme.colors;

export function Remittances() {
    const t = useTaxFilings(api);
    const due = t.nextDue;
    const [recording, setRecording] = useState<FilingPeriod | null>(null);
    const [flash, setFlash] = useState<string | null>(null);

    return (
        <View style={styles.screen}>
            <ScrollView contentContainerStyle={styles.page}>
                {t.load.state === "loading" ? (
                    <Skeleton variant="row" count={4} label={s.loading} />
                ) : t.load.state === "error" ? (
                    <LoadFailed
                        variant="card"
                        message={s.loadError}
                        onRetry={t.load.retry}
                        retrying={t.load.retrying}
                    />
                ) : !t.registered && t.periods.length === 0 ? (
                    <Empty variant="card" icon="building" message={s.notRegistered} />
                ) : t.load.state === "empty" ? (
                    <Empty
                        variant="card"
                        icon="building"
                        message={s.noPeriods}
                        body={s.noPeriodsBody}
                    />
                ) : (
                    <>
                        <Text style={ui.note}>{s.subtitle(t.federalLabel, t.provincialLabel)}</Text>
                        {flash !== null ? (
                            <Notice tone="success" banner>
                                {flash}
                            </Notice>
                        ) : null}
                        <View style={styles.hero}>
                            <Text style={styles.heroLabel}>{s.owed}</Text>
                            <Text style={styles.heroValue}>
                                {formatMoney(t.federalSetAsideCents)}
                            </Text>
                            <Text style={styles.heroHint}>{s.owedHint}</Text>
                            {t.unfiled.map((p) => (
                                <View key={p.key} style={styles.line}>
                                    <View style={styles.lineMain}>
                                        <Text style={styles.lineTitle}>{p.title}</Text>
                                        <Text style={styles.lineSub}>{p.span}</Text>
                                    </View>
                                    <StatusPill
                                        status={s.status[p.status] ?? p.status}
                                        intent={filingStatusIntent(p.status)}
                                        asWritten
                                    />
                                    <Text style={styles.lineAmount}>
                                        {formatMoney(p.federalCents)}
                                    </Text>
                                </View>
                            ))}
                            {t.provincialLabel !== null ? (
                                <View style={styles.provincial}>
                                    <Text style={styles.lineSub}>
                                        {s.provincialOwed(t.provincialLabel)}
                                    </Text>
                                    <Text style={styles.lineAmount}>
                                        {formatMoney(t.provincialSetAsideCents)}
                                    </Text>
                                </View>
                            ) : null}
                        </View>
                        {due !== null ? (
                            <View style={styles.due}>
                                <View style={styles.dueHead}>
                                    <Icon name="clock" size={16} color={c.warnFg} />
                                    <Text style={styles.dueText}>{filingWhen(due)}</Text>
                                </View>
                                <Text style={styles.dueBody}>{`${due.title} · ${due.span}`}</Text>
                                <Button
                                    full
                                    onPress={() => {
                                        setFlash(null);
                                        setRecording(due);
                                    }}
                                >
                                    {s.recordFiled}
                                </Button>
                                {t.reminderOn !== null ? (
                                    <Text style={ui.note}>
                                        {s.reminder(formatShortDay(t.reminderOn))}
                                    </Text>
                                ) : null}
                            </View>
                        ) : null}
                        <Text style={styles.caption}>{s.history}</Text>
                        <Panel flush>
                            {t.filed.length === 0 ? (
                                <Empty message={s.noHistory} />
                            ) : (
                                t.filed.map((p) => (
                                    <ListRow
                                        key={p.key}
                                        icon="checkCircle"
                                        intent="success"
                                        title={p.title}
                                        detail={`${filingWhen(p)}${
                                            p.federalReturn?.confirmation
                                                ? ` · ${p.federalReturn.confirmation}`
                                                : ""
                                        }`}
                                        meta={formatMoney(p.federalReturn?.paid_cents ?? 0)}
                                    />
                                ))
                            )}
                        </Panel>
                    </>
                )}
            </ScrollView>
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
                                s.familyFor(
                                    family === "federal"
                                        ? t.federalLabel
                                        : (t.provincialLabel ?? ""),
                                ),
                            ),
                        );
                        t.refresh();
                    }}
                />
            ) : null}
        </View>
    );
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
    const form = useFilingForm(api, period, onDone);
    const federal = form.family === "federal";
    const code = federal ? t.federalLabel : (t.provincialLabel ?? "");
    return (
        <Modal open size="xl" onClose={onClose}>
            <ScrollView contentContainerStyle={styles.sheet}>
                <Text style={styles.sheetTitle}>{s.recordTitle(period.title)}</Text>
                <Text
                    style={ui.note}
                >{`${period.span} · ${s.dueOn(formatShortDay(period.due))}`}</Text>
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
                        <DocTotals
                            lines={
                                federal
                                    ? [
                                          {
                                              key: "101",
                                              label: s.taxableSales,
                                              cents: period.taxableCents,
                                              kind: "subtotal",
                                          },
                                          {
                                              key: "105",
                                              label: s.collected(code),
                                              cents: period.federalCents,
                                              kind: "tax",
                                          },
                                          {
                                              key: "108",
                                              label: s.itcLine,
                                              cents: form.itcCents,
                                              kind: "credit",
                                          },
                                          {
                                              key: "109",
                                              label: s.netLine,
                                              cents: form.netCents,
                                              kind: "balance",
                                          },
                                      ]
                                    : [
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
                                      ]
                            }
                        />
                        {federal ? (
                            <TextField
                                label={s.itcField}
                                hint={s.itcHint}
                                prefix="$"
                                type="number"
                                placeholder="0.00"
                                value={form.itc}
                                onChange={form.setItc}
                            />
                        ) : null}
                        <TextField
                            label={federal ? s.confirmationField : s.provincialConfirmationField}
                            value={form.confirmation}
                            onChange={form.setConfirmation}
                        />
                        <DateField
                            label={s.filedOnField}
                            value={form.filedOn}
                            onChange={form.setFiledOn}
                        />
                        {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                        <Text style={ui.note}>{s.recordHint}</Text>
                        <Button full busy={form.busy} onPress={form.submit}>
                            {form.busy ? s.recording : s.record}
                        </Button>
                    </>
                )}
            </ScrollView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    page: { gap: 12, padding: 16, paddingBottom: 32 },
    sheet: { gap: 12, paddingBottom: 24 },
    hero: {
        backgroundColor: c.surface,
        borderColor: c.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        padding: 18,
    },
    heroLabel: { color: c.muted, fontSize: 13 },
    heroValue: {
        color: c.ink,
        fontSize: 32,
        fontWeight: "700",
        fontVariant: ["tabular-nums"],
        marginTop: 2,
    },
    heroHint: { color: c.muted, fontSize: 13, marginTop: 2, marginBottom: 8 },
    line: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 10,
        borderTopColor: c.borderSoft,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    lineMain: { flex: 1 },
    lineTitle: { color: c.ink, fontSize: 15, fontWeight: "600" },
    lineSub: { color: c.muted, fontSize: 12, marginTop: 1 },
    lineAmount: { color: c.ink, fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
    provincial: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        backgroundColor: c.bg,
        borderRadius: theme.radius,
        padding: 12,
        marginTop: 6,
    },
    due: { backgroundColor: c.warnBg, borderRadius: theme.radius, padding: 16, gap: 10 },
    dueHead: { flexDirection: "row", alignItems: "center", gap: 6 },
    dueText: { color: c.warnFg, fontSize: 14, fontWeight: "700" },
    dueBody: { color: c.ink, fontSize: 14, lineHeight: 20 },
    caption: {
        color: c.muted,
        fontSize: 12,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    sheetTitle: { color: c.ink, fontSize: 18, fontWeight: "700" },
});
