import {
    earningStaffLabel,
    earningStatusIntent,
    canManagePayments,
    formatMoney,
    formatRelativeTime,
    strings,
    useEarningActions,
    useEarningFilter,
    useEarnings,
    type EarningRow,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";

const c = theme.colors;

export function PayoutsScreen() {
    const role = useRole();

    if (!canManagePayments(role)) {
        return (
            <View style={[styles.screen, styles.center]}>
                <Text style={styles.muted}>{strings.payouts.noAccessMobile}</Text>
            </View>
        );
    }
    return <PayoutsBody />;
}

function PayoutsBody() {
    const rows = useEarnings();
    const { filter, setFilter, filters, shown, countOf } = useEarningFilter(rows);

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <View style={styles.tabs}>
                {filters.map((f) => (
                    <Pressable
                        key={f}
                        style={[styles.tab, filter === f && styles.tabActive]}
                        onPress={() => {
                            setFilter(f);
                        }}
                    >
                        <Text style={[styles.tabText, filter === f && styles.tabTextActive]}>
                            {strings.payouts.filterTab(f, countOf(f))}
                        </Text>
                    </Pressable>
                ))}
            </View>

            {shown.length === 0 ? (
                <Text style={styles.muted}>{strings.payouts.empty(filter)}</Text>
            ) : (
                <View style={styles.list}>
                    {shown.map((row, i) => (
                        <EarningItem key={row.id} row={row} divider={i > 0} />
                    ))}
                </View>
            )}
        </ScrollView>
    );
}

function EarningItem({ row, divider }: { row: EarningRow; divider: boolean }) {
    const { busy, error, canApprove, canPay, approve, pay } = useEarningActions(api, row);

    return (
        <View style={[styles.row, divider && styles.rowDivider]}>
            <View style={styles.rowTop}>
                <View style={styles.rowMain}>
                    <Text style={styles.staff}>{earningStaffLabel(row)}</Text>
                    <Text style={styles.meta} numberOfLines={1}>
                        {strings.payouts.sourceBooking} · {formatRelativeTime(row.created_at)}
                    </Text>
                </View>
                <Text style={styles.amount}>{formatMoney(row.amount_cents)}</Text>
                <StatusBadge status={row.status} intent={earningStatusIntent(row.status)} />
            </View>
            {canApprove || canPay ? (
                <Pressable
                    style={[styles.action, busy && styles.actionBusy]}
                    onPress={canApprove ? approve : pay}
                    disabled={busy}
                >
                    <Text style={styles.actionText}>
                        {busy
                            ? canApprove
                                ? strings.payouts.approving
                                : strings.common.saving
                            : canApprove
                              ? strings.payouts.approve
                              : strings.payouts.markPaid}
                    </Text>
                </Pressable>
            ) : null}
            {error !== null ? <Text style={styles.error}>{error}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    center: { alignItems: "center", justifyContent: "center" },
    content: { padding: 16, gap: 14 },
    muted: { color: c.muted, fontSize: 14 },
    error: { color: c.danFg, fontSize: 13, marginTop: 6 },
    tabs: {
        flexDirection: "row",
        gap: 4,
        backgroundColor: c.surface,
        borderColor: c.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        padding: 4,
    },
    tab: { flex: 1, borderRadius: theme.radius - 2, paddingVertical: 7, alignItems: "center" },
    tabActive: { backgroundColor: c.accent },
    tabText: { color: c.muted, fontSize: 12, fontWeight: "600", textTransform: "capitalize" },
    tabTextActive: { color: c.accentInk },
    list: {
        backgroundColor: c.surface,
        borderColor: c.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        overflow: "hidden",
    },
    row: { paddingHorizontal: 14, paddingVertical: 12 },
    rowDivider: { borderTopWidth: theme.borderWidth, borderTopColor: c.borderSoft },
    rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
    rowMain: { flex: 1 },
    staff: { color: c.ink, fontSize: 14, fontWeight: "600" },
    meta: { color: c.muted, fontSize: 12, marginTop: 1 },
    amount: { color: c.ink, fontSize: 14, fontWeight: "700", fontVariant: ["tabular-nums"] },
    action: {
        marginTop: 10,
        alignSelf: "flex-start",
        backgroundColor: c.accent,
        borderRadius: theme.radius,
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    actionBusy: { opacity: 0.6 },
    actionText: { color: c.accentInk, fontSize: 13, fontWeight: "700" },
});
