import {
    canManagePayments,
    currencyAffix,
    earningStageIntent,
    formatMoney,
    formatShortDay,
    runCsvFile,
    statementFile,
    statementText,
    strings,
    useAdjustmentForm,
    useStatementHeader,
    useEarningApprovals,
    useMyEarnings,
    useStaffPayFile,
    formatParts,
    BUSINESS_CURRENCY,
    EARNINGS_VIEWS,
    type EarningsView,
    useBusinessZone,
    usePeoplePhotos,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Avatar,
    Button,
    Checkbox,
    Choice,
    DateField,
    DetailView,
    Empty,
    ListRow,
    LoadFailed,
    Modal,
    Notice,
    Panel,
    SheetHeader,
    Skeleton,
    Stat,
    StatusPill,
    TextField,
    ui,
} from "@clientbridge/ui";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";
import { useViewer } from "../lib/auth";
import { shareFile } from "../lib/files";
import { useOpenLink } from "../lib/links";

const s = strings.earnings;
const c = theme.colors;

type Group = ReturnType<typeof useEarningApprovals>["paidGroups"][number];
type Line = Group["lines"][number];

async function share(content: string, filename: string): Promise<void> {
    await shareFile(content, filename, filename.endsWith(".csv") ? "text/csv" : "text/plain");
}

export function Earnings() {
    const viewer = useViewer();
    return canManagePayments(viewer?.role ?? null) ? (
        <TeamPay staffId={viewer?.staffId ?? null} owner={viewer?.role === "owner"} />
    ) : (
        <MyPay staffId={viewer?.staffId ?? null} />
    );
}

function MyPay({ staffId }: { staffId: string | null }) {
    const zone = useBusinessZone();
    const header = useStatementHeader();
    const m = useMyEarnings(staffId);
    const file = useStaffPayFile(api, share);
    return (
        <ScrollView contentContainerStyle={styles.page}>
            {m.load.state === "loading" ? (
                <Skeleton variant="row" count={4} label={s.loading} />
            ) : m.load.state === "error" ? (
                <LoadFailed variant="card" onRetry={m.load.retry} retrying={m.load.retrying} />
            ) : m.load.state === "empty" ? (
                <Empty variant="card" icon="dollar" message={s.mine.empty} />
            ) : (
                <>
                    <Text style={ui.note}>{s.mine.subtitle}</Text>
                    {file.error !== null ? <Notice tone="danger">{file.error}</Notice> : null}
                    <Panel>
                        <View style={styles.stats}>
                            <Stat
                                currency={BUSINESS_CURRENCY}
                                label={s.toApprove}
                                cents={m.pendingCents}
                            />
                            <Stat
                                currency={BUSINESS_CURRENCY}
                                label={s.toPay}
                                cents={m.approvedCents}
                            />
                            <Stat
                                currency={BUSINESS_CURRENCY}
                                label={s.paidYtd}
                                cents={m.paidYtdCents}
                                tone="success"
                            />
                        </View>
                    </Panel>
                    <Choice<"todo" | "paid">
                        layout="segmented"
                        label={s.viewLabel}
                        options={[
                            { key: "todo", label: s.view.todo },
                            { key: "paid", label: s.view.paid },
                        ]}
                        value={m.view}
                        onChange={m.setView}
                    />
                    <Panel flush>
                        {m.view === "paid" ? (
                            m.paidGroups.length === 0 ? (
                                <Empty message={s.mine.noPaid} />
                            ) : (
                                m.paidGroups.map((g) => (
                                    <PaidRun
                                        key={g.key}
                                        group={g}
                                        zone={zone}
                                        onShare={() => {
                                            file.saveText(
                                                statementText(header, m.name, g),
                                                statementFile(g),
                                            );
                                        }}
                                    />
                                ))
                            )
                        ) : m.lines.length === 0 ? (
                            <Empty message={s.mine.noEarnings} />
                        ) : (
                            <EarningRows lines={m.lines} zone={zone} />
                        )}
                    </Panel>
                </>
            )}
        </ScrollView>
    );
}

function TeamPay({ staffId, owner }: { staffId: string | null; owner: boolean }) {
    const photos = usePeoplePhotos();
    const zone = useBusinessZone();
    const header = useStatementHeader();
    const e = useEarningApprovals(api, { staffId, owner });
    const file = useStaffPayFile(api, share);
    const openLink = useOpenLink();
    const [open, setOpen] = useState(false);
    const sel = e.selected;
    const [adjusting, setAdjusting] = useState(false);
    const day = (
        value: string | null,
        set: (d: string | null) => void,
        label: string,
        hint?: string,
    ) => (
        <DateField
            zone={zone}
            label={label}
            hint={hint}
            value={value ?? ""}
            onChange={(d) => {
                set(d === "" ? null : d);
            }}
        />
    );

    return (
        <View style={styles.screen}>
            <ScrollView contentContainerStyle={styles.page}>
                {e.load.state === "loading" ? (
                    <Skeleton variant="row" count={4} label={s.loading} />
                ) : e.load.state === "error" ? (
                    <LoadFailed variant="card" onRetry={e.load.retry} retrying={e.load.retrying} />
                ) : e.load.state === "empty" ? (
                    <Empty
                        variant="card"
                        icon="user"
                        message={s.noStaff}
                        body={s.noStaffBody}
                        actions={
                            <Button
                                variant="outline"
                                onPress={() => {
                                    openLink("team");
                                }}
                            >
                                {s.openTeam}
                            </Button>
                        }
                    />
                ) : (
                    <>
                        <Text style={ui.note}>{s.subtitle}</Text>
                        <Text style={ui.note}>{e.summary}</Text>
                        {e.totals.pendingCents === 0 &&
                        e.totals.approvedCents === 0 &&
                        e.totals.paidYtdCents === 0 ? null : (
                            <Panel>
                                <View style={styles.stats}>
                                    <Stat
                                        currency={BUSINESS_CURRENCY}
                                        label={s.toApprove}
                                        cents={e.totals.pendingCents}
                                    />
                                    <Stat
                                        currency={BUSINESS_CURRENCY}
                                        label={s.toPay}
                                        cents={e.totals.approvedCents}
                                    />
                                    <Stat
                                        currency={BUSINESS_CURRENCY}
                                        label={s.paidYtd}
                                        cents={e.totals.paidYtdCents}
                                        tone="success"
                                    />
                                </View>
                            </Panel>
                        )}
                        <Panel flush>
                            {e.payees.map((p) => (
                                <ListRow
                                    key={p.staffId}
                                    leading={
                                        <Avatar
                                            name={p.name}
                                            src={photos.staff(p.staffId)}
                                            color={p.color}
                                        />
                                    }
                                    title={p.name}
                                    detail={formatParts([
                                        p.title,
                                        p.figures,
                                        p.owesBackCents > 0
                                            ? s.owesBack(
                                                  formatMoney(p.owesBackCents, BUSINESS_CURRENCY),
                                              )
                                            : null,
                                    ])}
                                    meta={formatMoney(p.paidYtdCents, BUSINESS_CURRENCY)}
                                    onPress={() => {
                                        e.select(p.staffId);
                                        setOpen(true);
                                    }}
                                />
                            ))}
                        </Panel>
                    </>
                )}
            </ScrollView>
            {open && sel !== null ? (
                <DetailView
                    open
                    title={sel.name}
                    subtitle={sel.rates === "" ? s.noRate : sel.rates}
                    onClose={() => {
                        setOpen(false);
                    }}
                    actions={
                        e.editable ? (
                            <View style={styles.actions}>
                                <Button
                                    grow
                                    busy={e.busy === "approve"}
                                    disabled={!e.canApprove}
                                    onPress={e.approvePicked}
                                >
                                    {e.approveLabel}
                                </Button>
                                <Button
                                    grow
                                    variant="outline"
                                    busy={e.busy === "pay"}
                                    disabled={!e.canPay}
                                    onPress={e.pay}
                                >
                                    {e.payLabel}
                                </Button>
                            </View>
                        ) : undefined
                    }
                >
                    {e.editable ? null : <Notice tone="info">{s.readOnlySelf}</Notice>}
                    <Choice<EarningsView>
                        layout="segmented"
                        label={s.viewLabel}
                        options={EARNINGS_VIEWS.map((key) => ({ key, label: s.view[key] }))}
                        value={e.view}
                        onChange={e.setView}
                    />
                    {e.view === "todo" ? (
                        day(e.through, e.setThrough, s.through, s.throughHint)
                    ) : (
                        <>
                            {day(
                                e.range.from,
                                (from) => {
                                    e.setRange({ ...e.range, from });
                                },
                                s.from,
                            )}
                            {day(
                                e.range.to,
                                (to) => {
                                    e.setRange({ ...e.range, to });
                                },
                                s.to,
                            )}
                        </>
                    )}
                    {e.view === "all" ? (
                        <Checkbox
                            label={s.showReversed}
                            value={e.showReversed}
                            onChange={e.setShowReversed}
                        />
                    ) : null}
                    {e.error !== null ? <Notice tone="danger">{e.error}</Notice> : null}
                    {file.error !== null ? <Notice tone="danger">{file.error}</Notice> : null}
                    {e.view === "paid" ? (
                        e.paidGroups.length === 0 ? (
                            <Empty message={s.noPaid} />
                        ) : (
                            e.paidGroups.map((g) => (
                                <PaidRun
                                    key={g.key}
                                    group={g}
                                    zone={zone}
                                    busy={e.busy !== null}
                                    onShare={() => {
                                        file.saveText(
                                            statementText(header, sel.name, g),
                                            statementFile(g),
                                        );
                                    }}
                                    onCsv={() => {
                                        file.save(e.runCsvPath(g), runCsvFile(g));
                                    }}
                                    onUndo={e.editable ? e.undo : undefined}
                                    onUndoRun={
                                        e.editable
                                            ? () => {
                                                  e.undoRun(g);
                                              }
                                            : undefined
                                    }
                                />
                            ))
                        )
                    ) : e.lines.length === 0 ? (
                        <Empty message={e.emptyMessage} />
                    ) : (
                        <>
                            {e.view === "todo" && e.canPick ? (
                                <Checkbox
                                    label={s.selectAll}
                                    value={e.allPicked}
                                    mixed={e.picked.length > 0 && !e.allPicked}
                                    onChange={e.pickAll}
                                />
                            ) : null}
                            <EarningRows
                                lines={e.lines}
                                zone={zone}
                                picked={e.picked}
                                onPick={e.view === "todo" ? e.togglePick : undefined}
                                onUndo={e.undo}
                                busy={e.busy !== null}
                            />
                        </>
                    )}
                    {e.editable ? (
                        <Button
                            variant="outline"
                            icon="plus"
                            onPress={() => {
                                setAdjusting(true);
                            }}
                        >
                            {s.addAdjustment}
                        </Button>
                    ) : null}
                    <Text style={ui.note}>{s.paidVia}</Text>
                </DetailView>
            ) : null}
            {adjusting && sel !== null ? (
                <AdjustmentSheet
                    staffId={sel.staffId}
                    name={sel.name}
                    onClose={() => {
                        setAdjusting(false);
                    }}
                />
            ) : null}
        </View>
    );
}

function PaidRun({
    group,
    zone,
    busy = false,
    onShare,
    onCsv,
    onUndo,
    onUndoRun,
}: {
    group: Group;
    zone: string;
    busy?: boolean | undefined;
    onShare: () => void;
    onCsv?: (() => void) | undefined;
    onUndo?: ((line: Line) => void) | undefined;
    onUndoRun?: (() => void) | undefined;
}) {
    return (
        <View style={styles.group}>
            <View style={styles.groupHead}>
                <View>
                    <Text style={styles.groupTitle}>{group.label}</Text>
                    {group.through !== null ? <Text style={ui.note}>{group.through}</Text> : null}
                </View>
                <Text style={styles.amount}>
                    {formatMoney(group.totalCents, BUSINESS_CURRENCY)}
                </Text>
            </View>
            <View style={styles.runActions}>
                <Button size="sm" variant="outline" onPress={onShare}>
                    {s.shareStatement}
                </Button>
                {onCsv !== undefined ? (
                    <Button size="sm" variant="outline" onPress={onCsv}>
                        {s.downloadCsv}
                    </Button>
                ) : null}
                {onUndoRun !== undefined ? (
                    <Button size="sm" variant="link" disabled={busy} onPress={onUndoRun}>
                        {s.undoRun}
                    </Button>
                ) : null}
            </View>
            <EarningRows lines={group.lines} zone={zone} onUndo={onUndo} busy={busy} />
        </View>
    );
}

function EarningRows({
    lines,
    zone,
    picked,
    onPick,
    onUndo,
    busy = false,
}: {
    lines: readonly Line[];
    zone: string;
    picked?: readonly string[] | undefined;
    onPick?: ((id: string) => void) | undefined;
    onUndo?: ((line: Line) => void) | undefined;
    busy?: boolean | undefined;
}) {
    return (
        <>
            {lines.map((l) => (
                <ListRow
                    key={l.id}
                    density="compact"
                    leading={
                        onPick !== undefined && l.pickable ? (
                            <Checkbox
                                label={l.label}
                                hideLabel
                                value={picked?.includes(l.id) ?? false}
                                onChange={() => {
                                    onPick(l.id);
                                }}
                            />
                        ) : undefined
                    }
                    title={l.title}
                    detail={formatParts([formatShortDay(l.at, zone), l.detail])}
                    meta={
                        <View style={styles.meta}>
                            <Text style={styles.amount}>
                                {formatMoney(l.amountCents, BUSINESS_CURRENCY)}
                            </Text>
                            <StatusPill
                                status={s.stage[l.status] ?? l.status}
                                intent={earningStageIntent(l.status)}
                            />
                            {onUndo !== undefined && l.undo !== null ? (
                                <Button
                                    size="sm"
                                    variant="link"
                                    disabled={busy}
                                    label={
                                        l.undo === "unpay"
                                            ? s.undoPaymentFor(l.label)
                                            : s.undoApprovalFor(l.label)
                                    }
                                    onPress={() => {
                                        onUndo(l);
                                    }}
                                >
                                    {l.undo === "unpay" ? s.undoPayment : s.undoApproval}
                                </Button>
                            ) : null}
                        </View>
                    }
                />
            ))}
        </>
    );
}

function AdjustmentSheet({
    staffId,
    name,
    onClose,
}: {
    staffId: string;
    name: string;
    onClose: () => void;
}) {
    const a = s.adjustment;
    const form = useAdjustmentForm(api, staffId, onClose);
    return (
        <Modal open onClose={onClose} size="xl">
            <SheetHeader title={a.title} subtitle={name} onClose={onClose} />
            <View style={styles.form}>
                <Text style={ui.note}>{a.body}</Text>
                <Choice<"bonus" | "deduction">
                    layout="segmented"
                    label={a.kindLabel}
                    options={[
                        { key: "bonus", label: a.bonus },
                        { key: "deduction", label: a.deduction },
                    ]}
                    value={form.kind}
                    onChange={form.setKind}
                />
                <TextField
                    label={a.amount}
                    type="number"
                    {...currencyAffix(BUSINESS_CURRENCY)}
                    value={form.amount}
                    onChange={form.setAmount}
                />
                <TextField
                    label={a.reason}
                    hint={a.reasonHint}
                    maxLength={200}
                    value={form.reason}
                    onChange={form.setReason}
                />
                {form.error !== null ? (
                    <Notice tone="danger" banner>
                        {form.error}
                    </Notice>
                ) : null}
                <Button size="lg" full busy={form.busy} onPress={form.submit}>
                    {a.save}
                </Button>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    page: { gap: 12, padding: 16, paddingBottom: 32 },
    stats: { gap: 12 },
    actions: { flexDirection: "row", gap: 8 },
    runActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    form: { gap: 12 },
    group: { gap: 4 },
    groupHead: { flexDirection: "row", justifyContent: "space-between", paddingTop: 8 },
    groupTitle: { color: c.ink, fontFamily: theme.fonts.ui, fontSize: 14, fontWeight: "600" },
    meta: { alignItems: "flex-end", gap: 4 },
    amount: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: 14,
        fontWeight: "600",
        fontVariant: ["tabular-nums"],
    },
});
