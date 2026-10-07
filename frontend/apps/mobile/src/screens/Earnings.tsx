import {
    earningStageIntent,
    formatMoney,
    formatShortDay,
    strings,
    useEarningApprovals,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Avatar,
    Button,
    Checkbox,
    DetailView,
    Empty,
    ListRow,
    LoadFailed,
    Notice,
    Panel,
    Skeleton,
    Stat,
    StatusPill,
    ui,
} from "@clientbridge/ui";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";
import { useOpenLink } from "../lib/links";

const s = strings.earnings;
const c = theme.colors;

export function Earnings() {
    const e = useEarningApprovals(api);
    const openLink = useOpenLink();
    const [open, setOpen] = useState(false);
    const sel = e.selected;
    const pendingIds = e.lines.filter((l) => l.status === "pending").map((l) => l.id);
    const allPicked = pendingIds.length > 0 && pendingIds.every((id) => e.picked.includes(id));

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
                        <Panel>
                            <View style={styles.stats}>
                                <Stat label={s.toApprove} cents={e.totals.pendingCents} />
                                <Stat label={s.toPay} cents={e.totals.approvedCents} />
                                <Stat
                                    label={s.paidYtd}
                                    cents={e.totals.paidYtdCents}
                                    tone="success"
                                />
                            </View>
                        </Panel>
                        <Panel flush>
                            {e.payees.map((p) => (
                                <ListRow
                                    key={p.staffId}
                                    leading={<Avatar name={p.name} color={p.color} />}
                                    title={p.name}
                                    detail={s.count(p.pendingCount)}
                                    meta={formatMoney(p.pendingCents)}
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
                        <View style={styles.actions}>
                            <Button
                                grow
                                busy={e.busy}
                                disabled={e.picked.length === 0}
                                onPress={e.approvePicked}
                            >
                                {e.busy ? s.working : s.approveSelected(e.picked.length)}
                            </Button>
                            <Button
                                grow
                                variant="outline"
                                disabled={sel.approvedCents === 0 || e.busy}
                                onPress={e.payApproved}
                            >
                                {s.payApproved(formatMoney(sel.approvedCents))}
                            </Button>
                        </View>
                    }
                >
                    {e.error !== null ? <Notice tone="danger">{e.error}</Notice> : null}
                    <Checkbox
                        label={s.selectAll}
                        value={allPicked}
                        mixed={e.picked.length > 0 && !allPicked}
                        disabled={pendingIds.length === 0}
                        onChange={e.pickAllPending}
                    />
                    {e.lines.length === 0 ? <Empty message={s.noEarnings} /> : null}
                    {e.lines.map((l) => (
                        <ListRow
                            key={l.id}
                            density="compact"
                            leading={
                                l.status === "pending" ? (
                                    <Checkbox
                                        label={`${l.title}, ${l.detail}`}
                                        hideLabel
                                        value={e.picked.includes(l.id)}
                                        onChange={() => {
                                            e.togglePick(l.id);
                                        }}
                                    />
                                ) : undefined
                            }
                            title={l.title}
                            detail={`${formatShortDay(l.at)} · ${l.detail}`}
                            meta={
                                <View style={styles.meta}>
                                    <Text style={styles.amount}>{formatMoney(l.amountCents)}</Text>
                                    <StatusPill
                                        status={s.stage[l.status] ?? l.status}
                                        intent={earningStageIntent(l.status)}
                                        asWritten
                                    />
                                </View>
                            }
                        />
                    ))}
                    <Text style={ui.note}>{s.paidVia}</Text>
                </DetailView>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    page: { gap: 12, padding: 16, paddingBottom: 32 },
    stats: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
    actions: { flexDirection: "row", gap: 8 },
    meta: { alignItems: "flex-end", gap: 4 },
    amount: { color: c.ink, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
});
