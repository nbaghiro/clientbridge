// Hidden debug view (mobile) — opened by the 5-tap wordmark gesture. Shows live PowerSync + local rows.
import { theme } from "@clientbridge/tokens/theme";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useClientState } from "@clientbridge/app-core";

export function DebugOverlay({ visible, onClose }: { visible: boolean; onClose: () => void }) {
    const { status, tables, totalRows } = useClientState();

    return (
        <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <View style={styles.panel}>
                    <View style={styles.header}>
                        <Text style={styles.title}>client state · debug</Text>
                        <Pressable onPress={onClose} hitSlop={16}>
                            <Text style={styles.close}>✕</Text>
                        </Pressable>
                    </View>

                    <View style={styles.section}>
                        <Row k="connected" v={String(status.connected)} good={status.connected} />
                        <Row k="connecting" v={String(status.connecting)} />
                        <Row k="has synced" v={String(status.hasSynced ?? false)} />
                        <Row k="last synced" v={status.lastSyncedAt?.toLocaleTimeString() ?? "—"} />
                        <Row k="downloading" v={String(status.dataFlowStatus.downloading)} />
                        <Row k="uploading" v={String(status.dataFlowStatus.uploading)} />
                    </View>

                    <View style={styles.totals}>
                        <Text style={styles.dim}>{tables.length} tables with rows</Text>
                        <Text style={styles.dim}>{totalRows} rows on device</Text>
                    </View>

                    <ScrollView style={styles.list}>
                        {tables.length === 0 ? (
                            <Text style={styles.empty}>
                                no local rows yet — waiting for first sync…
                            </Text>
                        ) : (
                            tables.map((t) => (
                                <View key={t.table} style={styles.tableRow}>
                                    <Text style={styles.mono}>{t.table}</Text>
                                    <Text style={styles.monoDim}>{t.rows}</Text>
                                </View>
                            ))
                        )}
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
}

function Row({ k, v, good }: { k: string; v: string; good?: boolean }) {
    return (
        <View style={styles.row}>
            <Text style={styles.rowKey}>{k}</Text>
            <Text style={[styles.rowVal, good === true ? styles.rowValGood : null]}>{v}</Text>
        </View>
    );
}

const mono = "Courier";
const styles = StyleSheet.create({
    backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(20,22,26,0.45)" },
    panel: {
        maxHeight: "85%",
        backgroundColor: theme.colors.ink,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        paddingBottom: 24,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 18,
        paddingVertical: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "rgba(255,255,255,0.12)",
    },
    title: { color: theme.colors.bg, fontWeight: "700", fontSize: 15 },
    close: { color: theme.colors.bg, fontSize: 16, opacity: 0.7 },
    section: {
        paddingHorizontal: 18,
        paddingVertical: 12,
        gap: 4,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "rgba(255,255,255,0.12)",
    },
    row: { flexDirection: "row", justifyContent: "space-between" },
    rowKey: { color: "rgba(255,255,255,0.5)", fontFamily: mono, fontSize: 12 },
    rowVal: { color: "rgba(255,255,255,0.9)", fontFamily: mono, fontSize: 12 },
    rowValGood: { color: theme.colors.success },
    totals: {
        flexDirection: "row",
        justifyContent: "space-between",
        paddingHorizontal: 18,
        paddingVertical: 8,
    },
    dim: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontFamily: mono },
    list: { paddingHorizontal: 18 },
    empty: {
        color: "rgba(255,255,255,0.4)",
        textAlign: "center",
        paddingVertical: 36,
        fontSize: 12,
    },
    tableRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 5,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "rgba(255,255,255,0.06)",
    },
    mono: { color: theme.colors.bg, fontFamily: mono, fontSize: 12 },
    monoDim: { color: "rgba(255,255,255,0.8)", fontFamily: mono, fontSize: 12 },
});
