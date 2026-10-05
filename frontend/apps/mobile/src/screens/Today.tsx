import {
    activityLabel,
    canManagePayments,
    formatMoneyWithCurrency,
    formatRelativeTime,
    isRefundRow,
    strings,
    useTodaySummary,
    useRecentActivity,
    type ActivityRow,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useStatus } from "@powersync/react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconSettings, ListPage, Lockup, Money } from "@clientbridge/ui";

import { DebugOverlay } from "../components/DebugOverlay";
import { InboxButton } from "../components/InboxButton";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";
import type { RootStackParamList } from "../navigation";

export function TodayScreen() {
    const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
    const insets = useSafeAreaInsets();
    const status = useStatus();
    const connected = status.connected;

    const role = useRole();

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
        <View style={[styles.screen, { paddingTop: insets.top }]}>
            <StatusBar style="dark" />
            <View style={styles.topbar}>
                <Pressable onPress={onSecretTap}>
                    <Lockup
                        fontSize={18}
                        markColor={theme.colors.accent}
                        textColor={theme.colors.ink}
                    />
                </Pressable>
                <View style={styles.topActions}>
                    <InboxButton />
                    <Pressable
                        hitSlop={10}
                        onPress={() => {
                            nav.navigate("Setup");
                        }}
                    >
                        <IconSettings size={22} color={theme.colors.inkSoft} />
                    </Pressable>
                </View>
            </View>

            {canManagePayments(role) ? (
                <MoneyView status={<SyncStatus connected={connected} />} />
            ) : (
                <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
                    <Text style={styles.heading}>{strings.today.title}</Text>
                    <SyncStatus connected={connected} />
                </ScrollView>
            )}

            <DebugOverlay
                visible={debugOpen}
                onClose={() => {
                    setDebugOpen(false);
                }}
            />
        </View>
    );
}

function SyncStatus({ connected }: { connected: boolean }) {
    return (
        <View style={styles.statusRow}>
            <View
                style={[
                    styles.dot,
                    { backgroundColor: connected ? theme.colors.success : theme.colors.muted },
                ]}
            />
            <Text style={styles.status}>
                PowerSync · {connected ? strings.today.connected : strings.today.offline}
            </Text>
        </View>
    );
}

function MoneyView({ status }: { status: ReactNode }) {
    const summary = useTodaySummary(api);
    const activity = useRecentActivity();

    return (
        <ListPage
            banner={
                <>
                    <Text style={styles.heading}>{strings.today.title}</Text>
                    {summary === "error" ? (
                        <Text style={styles.errorText}>{strings.today.numbersError}</Text>
                    ) : (
                        <View style={styles.cards}>
                            <MoneyCard
                                label={strings.today.todayRevenue}
                                cents={summary === null ? null : summary.today_revenue_cents}
                                caption={strings.today.todayRevenueCaption}
                                tone="success"
                            />
                            <MoneyCard
                                label={strings.today.awaitingPayment}
                                cents={summary === null ? null : summary.awaiting_payment_cents}
                                caption={strings.today.awaitingPaymentCaption}
                            />
                            <MoneyCard
                                label={strings.today.gstSetAside}
                                cents={summary === null ? null : summary.gst_hst_set_aside_cents}
                                caption={strings.today.gstSetAsideCaption}
                            />
                        </View>
                    )}
                </>
            }
            head={<Text style={styles.sectionTitle}>{strings.today.recentActivity}</Text>}
            rows={activity}
            rowKey={(row) => row.id}
            empty={strings.today.noPayments}
            renderRow={(row) => <ActivityItem row={row} />}
            footer={status}
        />
    );
}

function ActivityItem({ row }: { row: ActivityRow }) {
    const refund = isRefundRow(row);
    return (
        <View style={styles.row}>
            <View style={styles.rowMain}>
                <Text style={styles.activityLabel}>{activityLabel(row)}</Text>
                {row.client_name !== null ? (
                    <Text style={styles.activityClient} numberOfLines={1}>
                        {row.client_name}
                    </Text>
                ) : null}
            </View>
            <Text style={refund && styles.amountRefund}>
                {refund ? "−" : ""}
                <Money cents={row.amount_cents} tone={refund ? "danger" : "ink"} strong />
            </Text>
            <Text style={styles.time}>{formatRelativeTime(row.at)}</Text>
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
    topActions: { flexDirection: "row", alignItems: "center", gap: 18 },
    body: { flex: 1 },
    bodyContent: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, gap: 16 },
    heading: { color: theme.colors.ink, fontSize: 22, fontWeight: "700", marginTop: 8 },
    cards: { gap: 12, marginTop: 14 },
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
    sectionTitle: { color: theme.colors.ink, fontSize: 16, fontWeight: "700", marginTop: 12 },
    row: { flexDirection: "row", alignItems: "center", gap: 10 },
    rowMain: { flex: 1 },
    activityLabel: { color: theme.colors.ink, fontSize: 14, fontWeight: "600" },
    activityClient: { color: theme.colors.muted, fontSize: 12, marginTop: 1 },
    amountRefund: { color: theme.colors.danFg },
    time: { color: theme.colors.muted, fontSize: 12, width: 44, textAlign: "right" },
    statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16 },
    dot: { width: 9, height: 9, borderRadius: 5 },
    status: { color: theme.colors.inkSoft, fontSize: 14, fontWeight: "600" },
});
