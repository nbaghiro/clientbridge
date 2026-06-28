import {
    activityLabel,
    canManagePayments,
    formatMoneyWithCurrency,
    formatMonthDay,
    formatRelativeTime,
    isRefundRow,
    parseTimestamp,
    paymentStatusIntent,
    useCurrentRole,
    useDashboardSummary,
    useRecentActivity,
    useRecentPayouts,
    type ActivityRow,
    type PayoutRow,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useStatus } from "@powersync/react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DebugOverlay } from "../components/DebugOverlay";
import { IconChevron, IconSettings, Logo } from "../components/icons";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import { getTokens } from "../lib/auth";
import type { RootStackParamList } from "../navigation";

export function HomeScreen() {
    const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
    const status = useStatus();
    const connected = status.connected;

    const [token, setToken] = useState<string | null>(null);
    useEffect(() => {
        void getTokens().then((t) => {
            setToken(t?.access_token ?? null);
        });
    }, []);
    const role = useCurrentRole(token);

    const [debugOpen, setDebugOpen] = useState(false);
    const taps = useRef<number[]>([]);
    const onSecretTap = (): void => {
        const now = Date.now();
        taps.current = [...taps.current, now].filter((t) => now - t < 1500);
        if (taps.current.length >= 5) {
            taps.current = [];
            setDebugOpen(true);
        }
    };

    return (
        <SafeAreaView style={styles.screen} edges={["top"]}>
            <StatusBar style="dark" />
            <View style={styles.topbar}>
                <Pressable onPress={onSecretTap} style={styles.brand}>
                    <Logo size={20} color={theme.colors.accent} />
                    <Text style={styles.wordmark}>Clientbridge</Text>
                </Pressable>
                <Pressable
                    hitSlop={10}
                    onPress={() => {
                        nav.navigate("Settings");
                    }}
                >
                    <IconSettings size={22} color={theme.colors.inkSoft} />
                </Pressable>
            </View>

            <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
                <Text style={styles.heading}>Today</Text>

                {canManagePayments(role) ? <MoneySection /> : null}

                <View style={styles.statusRow}>
                    <View
                        style={[
                            styles.dot,
                            {
                                backgroundColor: connected
                                    ? theme.colors.success
                                    : theme.colors.muted,
                            },
                        ]}
                    />
                    <Text style={styles.status}>
                        PowerSync · {connected ? "connected" : "offline"}
                    </Text>
                </View>

                <Pressable
                    style={styles.linkCard}
                    onPress={() => {
                        nav.navigate("Invoices");
                    }}
                >
                    <Text style={styles.linkLabel}>Invoices</Text>
                    <IconChevron size={18} color={theme.colors.muted} />
                </Pressable>
            </ScrollView>

            <DebugOverlay
                visible={debugOpen}
                onClose={() => {
                    setDebugOpen(false);
                }}
            />
        </SafeAreaView>
    );
}

function MoneySection() {
    const summary = useDashboardSummary(api);
    const activity = useRecentActivity();
    const payouts = useRecentPayouts();

    return (
        <>
            {summary === "error" ? (
                <Text style={styles.errorText}>Couldn’t load your numbers.</Text>
            ) : (
                <View style={styles.cards}>
                    <MoneyCard
                        label="Today's revenue"
                        cents={summary === null ? null : summary.today_revenue_cents}
                        caption="received today"
                        tone="success"
                    />
                    <MoneyCard
                        label="Awaiting payment"
                        cents={summary === null ? null : summary.awaiting_payment_cents}
                        caption="outstanding invoices"
                    />
                    <MoneyCard
                        label="GST/HST set aside"
                        cents={summary === null ? null : summary.gst_hst_set_aside_cents}
                        caption="remit to CRA"
                    />
                </View>
            )}

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Recent activity</Text>
                {activity.length === 0 ? (
                    <Text style={styles.emptyText}>No payments yet.</Text>
                ) : (
                    <View style={styles.list}>
                        {activity.map((row, i) => (
                            <ActivityItem key={row.id} row={row} divider={i > 0} />
                        ))}
                    </View>
                )}
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Payouts</Text>
                {payouts.length === 0 ? (
                    <Text style={styles.emptyText}>No payouts yet.</Text>
                ) : (
                    <View style={styles.list}>
                        {payouts.map((row, i) => (
                            <PayoutItem key={row.id} row={row} divider={i > 0} />
                        ))}
                    </View>
                )}
            </View>
        </>
    );
}

function ActivityItem({ row, divider }: { row: ActivityRow; divider: boolean }) {
    const refund = isRefundRow(row);
    return (
        <View style={[styles.row, divider && styles.rowDivider]}>
            <View style={styles.rowMain}>
                <Text style={styles.activityLabel}>{activityLabel(row)}</Text>
                {row.client_name !== null ? (
                    <Text style={styles.activityClient} numberOfLines={1}>
                        {row.client_name}
                    </Text>
                ) : null}
            </View>
            <Text style={[styles.amount, refund && styles.amountRefund]}>
                {refund ? "−" : ""}
                {formatMoneyWithCurrency(row.amount_cents, row.currency)}
            </Text>
            <Text style={styles.time}>{formatRelativeTime(row.created_at)}</Text>
        </View>
    );
}

function PayoutItem({ row, divider }: { row: PayoutRow; divider: boolean }) {
    return (
        <View style={[styles.row, divider && styles.rowDivider]}>
            <Text style={styles.amount}>{formatMoneyWithCurrency(row.amount_cents, "CAD")}</Text>
            <StatusBadge status={row.status} intent={paymentStatusIntent(row.status)} />
            {row.bank_last4 !== null ? (
                <Text style={styles.meta}>to ····{row.bank_last4}</Text>
            ) : null}
            {row.arrival_at !== null ? (
                <Text style={styles.arrival}>{formatMonthDay(parseTimestamp(row.arrival_at))}</Text>
            ) : null}
        </View>
    );
}

function MoneyCard({
    label,
    cents,
    caption,
    tone = "ink",
}: {
    label: string;
    cents: number | null;
    caption: string;
    tone?: "ink" | "success";
}) {
    return (
        <View style={styles.card}>
            <Text style={styles.cardLabel}>{label}</Text>
            {cents === null ? (
                <View style={styles.skeleton} />
            ) : (
                <Text
                    style={[
                        styles.cardAmount,
                        tone === "success" ? styles.cardAmountSuccess : null,
                    ]}
                >
                    {formatMoneyWithCurrency(cents, "CAD")}
                </Text>
            )}
            <Text style={styles.cardCaption}>{caption}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    topbar: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        paddingVertical: 12,
    },
    brand: { flexDirection: "row", alignItems: "center", gap: 8 },
    wordmark: { color: theme.colors.ink, fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
    body: { flex: 1 },
    bodyContent: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, gap: 16 },
    heading: { color: theme.colors.ink, fontSize: 22, fontWeight: "700" },
    cards: { gap: 12 },
    card: {
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    cardLabel: { color: theme.colors.muted, fontSize: 13, fontWeight: "600" },
    cardAmount: {
        color: theme.colors.ink,
        fontSize: 26,
        fontWeight: "700",
        marginTop: 4,
        letterSpacing: -0.3,
    },
    cardAmountSuccess: { color: theme.colors.success },
    cardCaption: { color: theme.colors.muted, fontSize: 12, marginTop: 4 },
    skeleton: {
        height: 30,
        width: 130,
        borderRadius: 6,
        backgroundColor: theme.colors.bg,
        marginTop: 6,
    },
    errorText: { color: theme.colors.muted, fontSize: 14 },
    section: { gap: 8 },
    sectionTitle: { color: theme.colors.ink, fontSize: 16, fontWeight: "700" },
    emptyText: { color: theme.colors.muted, fontSize: 14 },
    list: {
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        overflow: "hidden",
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    rowDivider: { borderTopWidth: theme.borderWidth, borderTopColor: theme.colors.borderSoft },
    rowMain: { flex: 1 },
    activityLabel: { color: theme.colors.ink, fontSize: 14, fontWeight: "600" },
    activityClient: { color: theme.colors.muted, fontSize: 12, marginTop: 1 },
    amount: { color: theme.colors.ink, fontSize: 14, fontWeight: "600" },
    amountRefund: { color: theme.colors.danFg },
    time: { color: theme.colors.muted, fontSize: 12, width: 44, textAlign: "right" },
    meta: { color: theme.colors.muted, fontSize: 12 },
    arrival: { color: theme.colors.muted, fontSize: 12, marginLeft: "auto" },
    statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    dot: { width: 9, height: 9, borderRadius: 5 },
    status: { color: theme.colors.inkSoft, fontSize: 14, fontWeight: "600" },
    linkCard: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        paddingHorizontal: 16,
        paddingVertical: 16,
    },
    linkLabel: { color: theme.colors.ink, fontSize: 15, fontWeight: "600" },
});
