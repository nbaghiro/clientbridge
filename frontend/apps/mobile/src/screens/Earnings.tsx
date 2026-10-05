import {
    earningSourceLabel,
    earningStaffLabel,
    earningStatusIntent,
    formatRelativeTime,
    strings,
    useEarningActions,
    useEarningFilter,
    useEarnings,
    type EarningRow,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { StatusPill } from "../ui/StatusPill";
import { api } from "../lib/api";
import { ListPage } from "../ui/ListPage";
import { Money } from "../ui/Money";

const c = theme.colors;

export function Earnings() {
    const rows = useEarnings();
    const { filter, setFilter, filters, shown, countOf } = useEarningFilter(rows);

    return (
        <ListPage
            summary={strings.earnings.subtitle}
            segments={{
                items: filters.map((f) => ({
                    key: f,
                    label: strings.earnings.filterTab(f, countOf(f)),
                })),
                active: filter,
                onSelect: setFilter,
            }}
            rows={shown}
            rowKey={(row) => row.id}
            empty={strings.earnings.empty(filter)}
            renderRow={(row) => <EarningItem row={row} />}
        />
    );
}

function EarningItem({ row }: { row: EarningRow }) {
    const { busy, error, canApprove, canPay, approve, pay } = useEarningActions(api, row);

    return (
        <View>
            <View style={styles.rowTop}>
                <View style={styles.rowMain}>
                    <Text style={styles.staff}>{earningStaffLabel(row)}</Text>
                    <Text style={styles.meta} numberOfLines={1}>
                        {earningSourceLabel(row)} · {formatRelativeTime(row.created_at)}
                    </Text>
                </View>
                <Money cents={row.amount_cents} strong />
                <StatusPill status={row.status} intent={earningStatusIntent(row.status)} />
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
                                ? strings.earnings.approving
                                : strings.common.saving
                            : canApprove
                              ? strings.earnings.approve
                              : strings.earnings.markPaid}
                    </Text>
                </Pressable>
            ) : null}
            {error !== null ? <Text style={styles.error}>{error}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    error: { color: c.danFg, fontSize: 13, marginTop: 6 },
    rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
    rowMain: { flex: 1 },
    staff: { color: c.ink, fontSize: 14, fontWeight: "600" },
    meta: { color: c.muted, fontSize: 12, marginTop: 1 },
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
