import { formatMoney, payoutStatusIntent, strings, usePayouts } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Badge,
    DetailSection,
    DetailView,
    Empty,
    KeyValueList,
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

const s = strings.payouts;
const c = theme.colors;

export function Payouts() {
    const p = usePayouts();
    const [open, setOpen] = useState(false);
    const sel = p.selected;

    return (
        <View style={styles.screen}>
            <ScrollView contentContainerStyle={styles.page}>
                {p.load.state === "loading" ? (
                    <Skeleton variant="row" count={5} label={s.loading} />
                ) : p.load.state === "error" ? (
                    <LoadFailed
                        variant="card"
                        message={s.loadError}
                        onRetry={p.load.retry}
                        retrying={p.load.retrying}
                    />
                ) : p.load.state === "empty" ? (
                    <Empty
                        variant="card"
                        icon="bank"
                        message={s.noPayouts}
                        body={s.noPayoutsBody}
                    />
                ) : (
                    <>
                        <Text style={ui.note}>{s.subtitle}</Text>
                        <Panel>
                            <View style={styles.stats}>
                                <Stat label={s.inStripe} cents={p.balanceCents} />
                                <Stat label={s.deposited} cents={p.depositedCents} tone="success" />
                                <Stat label={s.fees} cents={p.feesCents} hint={s.depositedHint} />
                            </View>
                        </Panel>
                        <Panel flush>
                            {p.payouts.length === 0 ? (
                                <Empty message={s.noPayouts} body={s.noPayoutsBody} />
                            ) : (
                                p.payouts.map((row) => (
                                    <ListRow
                                        key={row.id}
                                        icon={row.status === "failed" ? "alert" : "bank"}
                                        intent={row.status === "failed" ? "danger" : "neutral"}
                                        title={formatMoney(row.amountCents)}
                                        detail={row.when}
                                        meta={
                                            <StatusPill
                                                status={s.status[row.status] ?? row.status}
                                                intent={payoutStatusIntent(row.status)}
                                                asWritten
                                            />
                                        }
                                        onPress={() => {
                                            p.select(row.id);
                                            setOpen(true);
                                        }}
                                    />
                                ))
                            )}
                        </Panel>
                        <Text style={styles.caption}>{s.chargesTitle}</Text>
                        <Panel flush>
                            {p.charges.length === 0 ? (
                                <Empty message={s.noCharges} />
                            ) : (
                                p.charges.map((ch) => (
                                    <ListRow
                                        key={ch.id}
                                        density="compact"
                                        title={ch.client}
                                        detail={`${ch.description}${
                                            ch.refundedCents > 0
                                                ? ` · ${s.refunded(formatMoney(ch.refundedCents))}`
                                                : ""
                                        }`}
                                        meta={
                                            ch.feeCents === null ? (
                                                <Badge label={s.feePending} intent="warning" />
                                            ) : (
                                                formatMoney(ch.netCents)
                                            )
                                        }
                                    />
                                ))
                            )}
                        </Panel>
                        {p.feesPending > 0 ? <Text style={ui.note}>{s.feePendingHint}</Text> : null}
                    </>
                )}
            </ScrollView>
            {open && sel !== null ? (
                <DetailView
                    open
                    title={formatMoney(sel.amountCents)}
                    subtitle={sel.when}
                    onClose={() => {
                        setOpen(false);
                    }}
                >
                    {sel.status === "failed" ? (
                        <Notice tone="danger" banner>
                            {s.returnedNotice}
                        </Notice>
                    ) : null}
                    <DetailSection>
                        {sel.ref !== null ? (
                            <KeyValueList rows={[{ label: s.payoutRef, value: sel.ref }]} />
                        ) : null}
                        <Notice tone="info" banner>
                            {s.settledNotice}
                        </Notice>
                    </DetailSection>
                </DetailView>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    page: { gap: 12, padding: 16, paddingBottom: 32 },
    stats: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
    caption: {
        color: c.muted,
        fontSize: 12,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
});
