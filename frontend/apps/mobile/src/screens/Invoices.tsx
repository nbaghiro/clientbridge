import {
    type DocActionKey,
    type EstimateRow,
    type InvoiceRow,
    type PaymentRow,
    estimateActions,
    estimateStatusIntent,
    filterEstimates,
    filterInvoices,
    formatMoney,
    formatMoneyWithCurrency,
    invoiceActions,
    invoiceStatusIntent,
    isPayable,
    isRefundRow,
    isRefundable,
    payLinkUrl,
    paymentStatusIntent,
    refundPayment,
    useAsyncAction,
    useEstimates,
    useInvoicePayments,
    useInvoices,
    useLines,
    useSearch,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Modal,
    Pressable,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { IconSearch } from "../components/icons";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import { publicWebUrl } from "../lib/config";

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
    const { busy, error, run } = useAsyncAction();

    const isInvoice = kind === "invoices";
    const invoice = isInvoice ? (row as InvoiceRow | null) : null;
    const actions =
        row === null
            ? []
            : isInvoice
              ? invoiceActions(api, row as InvoiceRow)
              : estimateActions(api, row as EstimateRow);
    const payToken = invoice?.pay_token ?? null;
    const canPay = invoice !== null && isPayable(invoice);

    return (
        <Modal visible={row !== null} transparent animationType="slide" onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <View style={styles.sheet}>
                    {row !== null ? (
                        <>
                            <View style={styles.sheetHead}>
                                <View>
                                    <Text style={styles.sheetTitle}>
                                        {isInvoice ? "Invoice" : "Estimate"}{" "}
                                        {row.number !== null ? `#${row.number}` : "(draft)"}
                                    </Text>
                                    <Text style={styles.rowSub}>{row.client_name ?? "—"}</Text>
                                </View>
                                <StatusBadge
                                    status={row.status}
                                    intent={
                                        isInvoice
                                            ? invoiceStatusIntent(row.status)
                                            : estimateStatusIntent(row.status)
                                    }
                                />
                            </View>
                            <ScrollView style={styles.sheetBody}>
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
                                {canPay && payToken !== null ? (
                                    <PayLinkRow token={payToken} />
                                ) : null}
                                {invoice !== null ? (
                                    <PaymentsSection invoiceId={invoice.id} />
                                ) : null}
                            </ScrollView>
                            {error !== null ? <Text style={styles.errorText}>{error}</Text> : null}
                            <View style={styles.actions}>
                                <Pressable style={styles.cancel} onPress={onClose}>
                                    <Text style={styles.cancelText}>Close</Text>
                                </Pressable>
                                {actions.map((a) => (
                                    <Pressable
                                        key={a.key}
                                        style={styles.save}
                                        disabled={busy}
                                        onPress={() =>
                                            void run(a.run, {
                                                onSuccess: onClose,
                                                errorMessage: `Couldn't ${ACTION_LABELS[
                                                    a.key
                                                ].toLowerCase()} — please try again.`,
                                            })
                                        }
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

function PayLinkRow({ token }: { token: string }) {
    const url = payLinkUrl(publicWebUrl, token);
    const share = (): void => {
        void Share.share({ message: url });
    };
    return (
        <View style={styles.payLink}>
            <Text style={styles.sectionLabel}>Pay link</Text>
            <View style={styles.payLinkRow}>
                <Text style={styles.payLinkUrl} numberOfLines={1}>
                    {url}
                </Text>
                <Pressable style={styles.shareBtn} onPress={share}>
                    <Text style={styles.shareText}>Share</Text>
                </Pressable>
            </View>
        </View>
    );
}

function PaymentsSection({ invoiceId }: { invoiceId: string }) {
    const payments = useInvoicePayments(invoiceId);
    if (payments.length === 0) return null;
    return (
        <View style={styles.payments}>
            <Text style={styles.sectionLabel}>Payments</Text>
            {payments.map((p) => (
                <PaymentRowItem key={p.id} payment={p} payments={payments} />
            ))}
        </View>
    );
}

function PaymentRowItem({ payment, payments }: { payment: PaymentRow; payments: PaymentRow[] }) {
    const { busy, error, run } = useAsyncAction();
    const isRefund = isRefundRow(payment);
    const showRefund = isRefundable(payment, payments);

    const refund = (): void => {
        Alert.alert("Refund payment", "Refund this payment? This can't be undone.", [
            { text: "Cancel", style: "cancel" },
            {
                text: "Refund",
                style: "destructive",
                onPress: () =>
                    void run(() => refundPayment(api, payment.id), {
                        errorMessage: "Couldn't refund this payment. Please try again.",
                    }),
            },
        ]);
    };

    return (
        <View style={styles.payment}>
            <View style={styles.paymentMain}>
                <Text style={[styles.paymentAmount, isRefund && styles.paymentRefund]}>
                    {isRefund ? "−" : ""}
                    {formatMoneyWithCurrency(payment.amount_cents, payment.currency)}
                </Text>
                <Text style={styles.paymentMethod}>{isRefund ? "Refund" : payment.method}</Text>
                <StatusBadge status={payment.status} intent={paymentStatusIntent(payment.status)} />
                {showRefund ? (
                    <Pressable style={styles.refundBtn} disabled={busy} onPress={refund}>
                        <Text style={styles.refundText}>{busy ? "…" : "Refund"}</Text>
                    </Pressable>
                ) : null}
            </View>
            {error !== null ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
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
    sheetBody: { maxHeight: "70%" },
    sectionLabel: {
        color: c.muted,
        fontSize: 11,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    errorText: { color: c.danFg, fontSize: 13, marginTop: 8 },
    payLink: { marginTop: 16 },
    payLinkRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginTop: 6,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        backgroundColor: c.bg,
    },
    payLinkUrl: { flex: 1, color: c.inkSoft, fontSize: 13 },
    shareBtn: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: theme.radius,
        borderColor: c.border,
        borderWidth: 1,
    },
    shareText: { color: c.inkSoft, fontSize: 13, fontWeight: "600" },
    payments: { marginTop: 16 },
    payment: {
        marginTop: 6,
        paddingVertical: 8,
        borderTopColor: c.border,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    paymentMain: { flexDirection: "row", alignItems: "center", gap: 8 },
    paymentAmount: { color: c.ink, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
    paymentRefund: { color: c.danFg },
    paymentMethod: { color: c.muted, fontSize: 13, textTransform: "capitalize" },
    refundBtn: {
        marginLeft: "auto",
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: theme.radius,
        borderColor: c.border,
        borderWidth: 1,
    },
    refundText: { color: c.inkSoft, fontSize: 12, fontWeight: "600" },
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
