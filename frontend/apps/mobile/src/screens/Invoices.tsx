import {
    DOC_ACTION_LABEL,
    type DocTab,
    type EstimateRow,
    type InvoiceRow,
    type PaymentRow,
    canManagePayments,
    docDraft,
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
    useRefundForm,
    strings,
    useAsyncAction,
    useEstimates,
    useInvoicePayments,
    useInvoices,
    useLines,
    useSearch,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useEffect, useState } from "react";
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

import { IconPlus, IconSearch } from "../components/icons";
import { DocEditor } from "../ui/DocEditor";
import { StatusPill } from "../ui/StatusPill";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";
import { publicWebUrl } from "../lib/config";

const c = theme.colors;

export function InvoicesScreen({ createToken }: { createToken?: number | undefined }) {
    const invoices = useInvoices();
    const estimates = useEstimates();
    const [tab, setTab] = useState<DocTab>("invoices");
    const [creating, setCreating] = useState(false);
    const [openId, setOpenId] = useState<string | null>(null);
    const { q, setQ, filtered } = useSearch<InvoiceRow | EstimateRow>(
        tab === "invoices" ? invoices : estimates,
        (tab === "invoices" ? filterInvoices : filterEstimates) as (
            rows: (InvoiceRow | EstimateRow)[],
            q: string,
        ) => (InvoiceRow | EstimateRow)[],
    );
    const open = filtered.find((r) => r.id === openId) ?? null;
    useEffect(() => {
        if (createToken !== undefined) setCreating(true);
    }, [createToken]);

    return (
        <View style={styles.screen}>
            <View style={styles.header}>
                <Text style={styles.count}>
                    {strings.invoices.countSummary(invoices.length, estimates.length)}
                </Text>
                <Pressable
                    style={styles.add}
                    onPress={() => {
                        setCreating(true);
                    }}
                >
                    <IconPlus size={16} color={c.accentInk} />
                    <Text style={styles.addText}>{strings.invoices.newShort}</Text>
                </Pressable>
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
                    placeholder={strings.invoices.searchPlaceholder(tab)}
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
                                {item.number !== null
                                    ? `#${item.number}`
                                    : strings.invoices.draftRow}
                            </Text>
                            <Text style={styles.rowSub} numberOfLines={1}>
                                {item.client_name ?? "—"}
                            </Text>
                        </View>
                        <View style={styles.rowRight}>
                            <Text style={styles.rowValue}>{formatMoney(item.total_cents)}</Text>
                            <StatusPill
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
                        {q ? strings.invoices.searchEmpty(tab) : strings.invoices.empty(tab)}
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

            {creating ? (
                <DocEditor
                    kind={tab === "invoices" ? "invoice" : "estimate"}
                    onClose={() => {
                        setCreating(false);
                    }}
                />
            ) : null}
        </View>
    );
}

function DetailModal({
    kind,
    row,
    onClose,
}: {
    kind: DocTab;
    row: InvoiceRow | EstimateRow | null;
    onClose: () => void;
}) {
    const lines = useLines(kind === "invoices" ? "invoice" : "estimate", row?.id ?? "");
    const { busy, error, run } = useAsyncAction();
    const canRefund = canManagePayments(useRole());
    const [editing, setEditing] = useState(false);

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
        <>
            {editing && row !== null ? (
                <DocEditor
                    kind={isInvoice ? "invoice" : "estimate"}
                    draft={docDraft(row, lines)}
                    onClose={() => {
                        setEditing(false);
                    }}
                />
            ) : null}
            <Modal
                visible={row !== null && !editing}
                transparent
                animationType="slide"
                onRequestClose={onClose}
            >
                <View style={styles.backdrop}>
                    <View style={styles.sheet}>
                        {row !== null ? (
                            <>
                                <View style={styles.sheetHead}>
                                    <View>
                                        <Text style={styles.sheetTitle}>
                                            {isInvoice
                                                ? strings.invoices.invoiceHeading
                                                : strings.invoices.estimateHeading}{" "}
                                            {row.number !== null
                                                ? `#${row.number}`
                                                : strings.invoices.draftHeading}
                                        </Text>
                                        <Text style={styles.rowSub}>{row.client_name ?? "—"}</Text>
                                    </View>
                                    <StatusPill
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
                                        <Text style={styles.totalLabel}>
                                            {strings.invoices.total}
                                        </Text>
                                        <Text style={styles.totalValue}>
                                            {formatMoney(row.total_cents)}
                                        </Text>
                                    </View>
                                    {canPay && payToken !== null ? (
                                        <PayLinkRow token={payToken} />
                                    ) : null}
                                    {invoice !== null ? (
                                        <PaymentsSection
                                            invoiceId={invoice.id}
                                            canRefund={canRefund}
                                        />
                                    ) : null}
                                </ScrollView>
                                {error !== null ? (
                                    <Text style={styles.errorText}>{error}</Text>
                                ) : null}
                                <View style={styles.actions}>
                                    <Pressable style={styles.cancel} onPress={onClose}>
                                        <Text style={styles.cancelText}>
                                            {strings.common.close}
                                        </Text>
                                    </Pressable>
                                    {row.status === "draft" ? (
                                        <Pressable
                                            style={styles.cancel}
                                            onPress={() => {
                                                setEditing(true);
                                            }}
                                        >
                                            <Text style={styles.cancelText}>
                                                {strings.invoices.edit}
                                            </Text>
                                        </Pressable>
                                    ) : null}
                                    {actions.map((a) => (
                                        <Pressable
                                            key={a.key}
                                            style={styles.save}
                                            disabled={busy}
                                            onPress={() => {
                                                run(a.run, {
                                                    onSuccess: onClose,
                                                    errorMessage: strings.invoices.actionError(
                                                        DOC_ACTION_LABEL[a.key].toLowerCase(),
                                                    ),
                                                });
                                            }}
                                        >
                                            {busy ? (
                                                <ActivityIndicator color={c.accentInk} />
                                            ) : (
                                                <Text style={styles.saveText}>
                                                    {DOC_ACTION_LABEL[a.key]}
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
        </>
    );
}

function PayLinkRow({ token }: { token: string }) {
    const url = payLinkUrl(publicWebUrl, token);
    const share = (): void => {
        Share.share({ message: url }).catch(() => undefined);
    };
    return (
        <View style={styles.payLink}>
            <Text style={styles.sectionLabel}>{strings.invoices.payLink}</Text>
            <View style={styles.payLinkRow}>
                <Text style={styles.payLinkUrl} numberOfLines={1}>
                    {url}
                </Text>
                <Pressable style={styles.shareBtn} onPress={share}>
                    <Text style={styles.shareText}>{strings.invoices.share}</Text>
                </Pressable>
            </View>
        </View>
    );
}

function PaymentsSection({ invoiceId, canRefund }: { invoiceId: string; canRefund: boolean }) {
    const payments = useInvoicePayments(invoiceId);
    if (payments.length === 0) return null;
    return (
        <View style={styles.payments}>
            <Text style={styles.sectionLabel}>{strings.invoices.payments}</Text>
            {payments.map((p) => (
                <PaymentRowItem key={p.id} payment={p} payments={payments} canRefund={canRefund} />
            ))}
        </View>
    );
}

function PaymentRowItem({
    payment,
    payments,
    canRefund,
}: {
    payment: PaymentRow;
    payments: PaymentRow[];
    canRefund: boolean;
}) {
    const { amount, setAmount, remainingCents, busy, error, submit } = useRefundForm(
        api,
        payment,
        payments,
    );
    const isRefund = isRefundRow(payment);
    const showRefund = canRefund && isRefundable(payment, payments);

    const refund = (): void => {
        Alert.alert(strings.invoices.refundTitle, strings.invoices.refundConfirm, [
            { text: strings.common.cancel, style: "cancel" },
            {
                text: strings.invoices.refund,
                style: "destructive",
                onPress: submit,
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
                <Text style={styles.paymentMethod}>
                    {isRefund ? strings.invoices.refundBadge : payment.method}
                </Text>
                <StatusPill status={payment.status} intent={paymentStatusIntent(payment.status)} />
                {showRefund ? (
                    <TextInput
                        style={styles.refundInput}
                        value={amount}
                        onChangeText={setAmount}
                        keyboardType="decimal-pad"
                        placeholder={strings.invoices.refundAmountPlaceholder(
                            formatMoneyWithCurrency(remainingCents, payment.currency),
                        )}
                        placeholderTextColor={c.muted}
                    />
                ) : null}
                {showRefund ? (
                    <Pressable style={styles.refundBtn} disabled={busy} onPress={refund}>
                        <Text style={styles.refundText}>
                            {busy ? strings.invoices.refundingShort : strings.invoices.refund}
                        </Text>
                    </Pressable>
                ) : null}
            </View>
            {error !== null ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 8,
    },
    title: { color: c.ink, fontSize: 26, fontWeight: "700", letterSpacing: -0.4 },
    count: { color: c.muted, fontSize: 13, marginTop: 2 },
    add: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: c.accent,
        borderRadius: theme.radius,
        paddingHorizontal: 13,
        paddingVertical: 9,
    },
    addText: { color: c.accentInk, fontSize: 14, fontWeight: "700" },
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
    refundInput: {
        marginLeft: "auto",
        width: 96,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: theme.radius,
        borderColor: c.border,
        borderWidth: 1,
        color: c.ink,
        fontSize: 12,
    },
    refundBtn: {
        marginLeft: 6,
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
