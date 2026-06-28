import {
    type DocActionKey,
    type EstimateRow,
    type InvoiceRow,
    estimateActions,
    estimateStatusIntent,
    filterEstimates,
    filterInvoices,
    formatMoney,
    invoiceActions,
    invoiceStatusIntent,
    useAsyncAction,
    useEstimates,
    useInvoices,
    useLines,
    useSearch,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { IconSearch } from "../components/icons";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";

const c = theme.colors;
type Tab = "invoices" | "estimates";

const ACTION_LABELS: Record<DocActionKey, string> = {
    send: "Send",
    void: "Void",
    accept: "Accept",
    decline: "Decline",
    convert: "Convert",
};

export function InvoicesScreen() {
    const invoices = useInvoices();
    const estimates = useEstimates();
    const [tab, setTab] = useState<Tab>("invoices");
    const [openId, setOpenId] = useState<string | null>(null);
    const { q, setQ, filtered } = useSearch<InvoiceRow | EstimateRow>(
        tab === "invoices" ? invoices : estimates,
        (tab === "invoices" ? filterInvoices : filterEstimates) as (
            rows: (InvoiceRow | EstimateRow)[],
            q: string,
        ) => (InvoiceRow | EstimateRow)[],
    );
    const open = filtered.find((r) => r.id === openId) ?? null;

    return (
        <SafeAreaView style={styles.screen} edges={["top"]}>
            <View style={styles.header}>
                <Text style={styles.title}>Billing</Text>
                <Text style={styles.count}>
                    {invoices.length} invoices · {estimates.length} estimates
                </Text>
            </View>

            <View style={styles.tabs}>
                {(["invoices", "estimates"] as const).map((t) => (
                    <Pressable
                        key={t}
                        style={[styles.tab, tab === t && styles.tabOn]}
                        onPress={() => {
                            setTab(t);
                        }}
                    >
                        <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t}</Text>
                    </Pressable>
                ))}
            </View>

            <View style={styles.searchWrap}>
                <IconSearch size={16} color={c.muted} />
                <TextInput
                    style={styles.search}
                    value={q}
                    onChangeText={setQ}
                    placeholder={`Search ${tab}…`}
                    placeholderTextColor={c.muted}
                    autoCapitalize="none"
                />
            </View>

            <FlatList
                data={filtered}
                keyExtractor={(r) => r.id}
                contentContainerStyle={styles.list}
                renderItem={({ item }) => (
                    <Pressable
                        style={styles.row}
                        onPress={() => {
                            setOpenId(item.id);
                        }}
                    >
                        <View style={styles.rowMain}>
                            <Text style={styles.rowName}>
                                {item.number !== null ? `#${item.number}` : "Draft"}
                            </Text>
                            <Text style={styles.rowSub} numberOfLines={1}>
                                {item.client_name ?? "—"}
                            </Text>
                        </View>
                        <View style={styles.rowRight}>
                            <Text style={styles.rowValue}>{formatMoney(item.total_cents)}</Text>
                            <StatusBadge
                                status={item.status}
                                intent={
                                    tab === "invoices"
                                        ? invoiceStatusIntent(item.status)
                                        : estimateStatusIntent(item.status)
                                }
                            />
                        </View>
                    </Pressable>
                )}
                ListEmptyComponent={
                    <Text style={styles.empty}>
                        {q ? `No ${tab} match your search.` : `No ${tab} yet.`}
                    </Text>
                }
            />

            <DetailModal
                kind={tab}
                row={open}
                onClose={() => {
                    setOpenId(null);
                }}
            />
        </SafeAreaView>
    );
}

function DetailModal({
    kind,
    row,
    onClose,
}: {
    kind: Tab;
    row: InvoiceRow | EstimateRow | null;
    onClose: () => void;
}) {
    const lines = useLines(kind === "invoices" ? "invoice" : "estimate", row?.id ?? "");
    const { busy, run } = useAsyncAction();

    const actions =
        row === null
            ? []
            : kind === "invoices"
              ? invoiceActions(api, row as InvoiceRow)
              : estimateActions(api, row as EstimateRow);

    return (
        <Modal visible={row !== null} transparent animationType="slide" onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <View style={styles.sheet}>
                    {row !== null ? (
                        <>
                            <View style={styles.sheetHead}>
                                <View>
                                    <Text style={styles.sheetTitle}>
                                        {kind === "invoices" ? "Invoice" : "Estimate"}{" "}
                                        {row.number !== null ? `#${row.number}` : "(draft)"}
                                    </Text>
                                    <Text style={styles.rowSub}>{row.client_name ?? "—"}</Text>
                                </View>
                                <StatusBadge
                                    status={row.status}
                                    intent={
                                        kind === "invoices"
                                            ? invoiceStatusIntent(row.status)
                                            : estimateStatusIntent(row.status)
                                    }
                                />
                            </View>
                            {lines.map((l) => (
                                <View key={l.id} style={styles.lineRow}>
                                    <Text style={styles.lineDesc} numberOfLines={1}>
                                        {l.description}
                                    </Text>
                                    <Text style={styles.lineAmt}>
                                        {formatMoney(l.amount_cents)}
                                    </Text>
                                </View>
                            ))}
                            <View style={styles.totalRow}>
                                <Text style={styles.totalLabel}>Total</Text>
                                <Text style={styles.totalValue}>
                                    {formatMoney(row.total_cents)}
                                </Text>
                            </View>
                            <View style={styles.actions}>
                                <Pressable style={styles.cancel} onPress={onClose}>
                                    <Text style={styles.cancelText}>Close</Text>
                                </Pressable>
                                {actions.map((a) => (
                                    <Pressable
                                        key={a.key}
                                        style={styles.save}
                                        disabled={busy}
                                        onPress={() => void run(a.run, { onSuccess: onClose })}
                                    >
                                        {busy ? (
                                            <ActivityIndicator color={c.accentInk} />
                                        ) : (
                                            <Text style={styles.saveText}>
                                                {ACTION_LABELS[a.key]}
                                            </Text>
                                        )}
                                    </Pressable>
                                ))}
                            </View>
                        </>
                    ) : null}
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
    title: { color: c.ink, fontSize: 26, fontWeight: "700", letterSpacing: -0.4 },
    count: { color: c.muted, fontSize: 13, marginTop: 2 },
    tabs: {
        flexDirection: "row",
        gap: 4,
        marginHorizontal: 20,
        marginBottom: 10,
        padding: 4,
        borderRadius: theme.radius,
        backgroundColor: c.surface,
        borderColor: c.border,
        borderWidth: 1,
    },
    tab: { flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: theme.radius - 2 },
    tabOn: { backgroundColor: c.accent },
    tabText: { color: c.muted, fontSize: 14, fontWeight: "600", textTransform: "capitalize" },
    tabTextOn: { color: c.accentInk },
    searchWrap: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginHorizontal: 20,
        marginBottom: 8,
        paddingHorizontal: 12,
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        backgroundColor: c.surface,
    },
    search: { flex: 1, paddingVertical: 11, color: c.ink, fontSize: 15 },
    list: { paddingHorizontal: 20, paddingBottom: 24 },
    row: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 12,
        borderBottomColor: c.border,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    rowMain: { flex: 1 },
    rowName: { color: c.ink, fontSize: 15, fontWeight: "700" },
    rowSub: { color: c.muted, fontSize: 13, marginTop: 1 },
    rowRight: { alignItems: "flex-end", gap: 4 },
    rowValue: { color: c.ink, fontSize: 15, fontWeight: "600" },
    empty: { color: c.muted, textAlign: "center", paddingVertical: 48, fontSize: 14 },
    backdrop: { flex: 1, backgroundColor: c.scrim, justifyContent: "flex-end" },
    sheet: {
        backgroundColor: c.surface,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        padding: 22,
        paddingBottom: 36,
    },
    sheetHead: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        marginBottom: 12,
    },
    sheetTitle: { color: c.ink, fontSize: 18, fontWeight: "700" },
    lineRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 8,
        borderBottomColor: c.border,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    lineDesc: { color: c.ink, fontSize: 14, flex: 1 },
    lineAmt: { color: c.ink, fontSize: 14, fontWeight: "600", marginLeft: 12 },
    totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 12 },
    totalLabel: { color: c.muted, fontSize: 14 },
    totalValue: { color: c.ink, fontSize: 16, fontWeight: "700" },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 8 },
    cancel: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: theme.radius },
    cancelText: { color: c.inkSoft, fontSize: 14, fontWeight: "600" },
    save: {
        backgroundColor: c.accent,
        borderRadius: theme.radius,
        paddingHorizontal: 16,
        paddingVertical: 10,
        minWidth: 84,
        alignItems: "center",
    },
    saveText: { color: c.accentInk, fontSize: 14, fontWeight: "700" },
});
