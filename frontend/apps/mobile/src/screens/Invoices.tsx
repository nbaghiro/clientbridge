import {
    DOC_ACTION_LABEL,
    DOC_TABS,
    type DocTab,
    type EstimateRow,
    type InvoiceRow,
    type PaymentRow,
    canManagePayments,
    docDraft,
    docHeading,
    estimateActions,
    estimateStatusIntent,
    filterEstimates,
    filterInvoices,
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
    refundPlaceholder,
    useDocTotals,
    useLines,
    useSearch,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useEffect, useState } from "react";
import { Alert, Share, StyleSheet, Text, View } from "react-native";
import {
    Button,
    DetailSection,
    DetailView,
    ListPage,
    Money,
    Notice,
    StatusPill,
    TextField,
} from "@clientbridge/ui";

import { DocEditor } from "../components/DocEditor";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";
import { publicWebUrl } from "../lib/config";

const c = theme.colors;

export function Invoices({ createToken }: { createToken?: number | undefined }) {
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
            <ListPage
                summary={strings.billing.countSummary(invoices.length, estimates.length)}
                action={{
                    label: strings.billing.newShort,
                    onPress: () => {
                        setCreating(true);
                    },
                }}
                segments={{ items: DOC_TABS, active: tab, onSelect: setTab }}
                search={{
                    value: q,
                    onChange: setQ,
                    placeholder: strings.billing.searchPlaceholder(tab),
                }}
                rows={filtered}
                rowKey={(r) => r.id}
                onRowPress={(r) => {
                    setOpenId(r.id);
                }}
                empty={q ? strings.billing.searchEmpty(tab) : strings.billing.empty(tab)}
                renderRow={(item) => (
                    <View style={styles.row}>
                        <View style={styles.rowMain}>
                            <Text style={styles.rowName}>
                                {item.number !== null
                                    ? `#${String(item.number)}`
                                    : strings.billing.draftRow}
                            </Text>
                            <Text style={styles.rowSub} numberOfLines={1}>
                                {item.client_name ?? strings.clients.dash}
                            </Text>
                        </View>
                        <View style={styles.rowRight}>
                            <Money cents={item.total_cents} strong />
                            <StatusPill
                                status={item.status}
                                intent={
                                    tab === "invoices"
                                        ? invoiceStatusIntent(item.status)
                                        : estimateStatusIntent(item.status)
                                }
                            />
                        </View>
                    </View>
                )}
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
    const parentType = kind === "invoices" ? "invoice" : "estimate";
    const lines = useLines(row?.id ?? "");
    const totals = useDocTotals(parentType, row);
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
            {row !== null && !editing ? (
                <DetailView
                    open
                    title={docHeading(kind, row.number)}
                    subtitle={row.client_name ?? strings.clients.dash}
                    status={{
                        status: row.status,
                        intent: isInvoice
                            ? invoiceStatusIntent(row.status)
                            : estimateStatusIntent(row.status),
                    }}
                    onClose={onClose}
                    actions={
                        <>
                            {row.status === "draft" ? (
                                <Button
                                    variant="outline"
                                    onPress={() => {
                                        setEditing(true);
                                    }}
                                >
                                    {strings.billing.edit}
                                </Button>
                            ) : null}
                            {actions.map((a) => (
                                <Button
                                    key={a.key}
                                    busy={busy}
                                    onPress={() => {
                                        run(a.run, {
                                            onSuccess: onClose,
                                            errorMessage: strings.billing.actionError(
                                                DOC_ACTION_LABEL[a.key].toLowerCase(),
                                            ),
                                        });
                                    }}
                                >
                                    {DOC_ACTION_LABEL[a.key]}
                                </Button>
                            ))}
                        </>
                    }
                >
                    <DetailSection>
                        {lines.map((l) => (
                            <View key={l.id} style={styles.lineRow}>
                                <Text style={styles.lineDesc} numberOfLines={1}>
                                    {l.description}
                                </Text>
                                <Money cents={l.amount_cents} />
                            </View>
                        ))}
                        {totals.map((t) => (
                            <View key={t.key} style={t.strong ? styles.totalRow : styles.taxRow}>
                                <Text style={styles.totalLabel}>{t.label}</Text>
                                <Money cents={t.cents} strong={t.strong} />
                            </View>
                        ))}
                    </DetailSection>
                    {canPay && payToken !== null ? <PayLinkRow token={payToken} /> : null}
                    {invoice !== null ? (
                        <PaymentsSection invoiceId={invoice.id} canRefund={canRefund} />
                    ) : null}
                    {error !== null ? <Notice tone="danger">{error}</Notice> : null}
                </DetailView>
            ) : null}
        </>
    );
}

function PayLinkRow({ token }: { token: string }) {
    const url = payLinkUrl(publicWebUrl, token);
    const share = (): void => {
        Share.share({ message: url }).catch(() => undefined);
    };
    return (
        <DetailSection title={strings.billing.payLink}>
            <View style={styles.payLinkRow}>
                <Text style={styles.payLinkUrl} numberOfLines={1}>
                    {url}
                </Text>
                <Button variant="outline" size="sm" onPress={share}>
                    {strings.billing.share}
                </Button>
            </View>
        </DetailSection>
    );
}

function PaymentsSection({ invoiceId, canRefund }: { invoiceId: string; canRefund: boolean }) {
    const payments = useInvoicePayments(invoiceId);
    if (payments.length === 0) return null;
    return (
        <DetailSection title={strings.billing.payments}>
            {payments.map((p) => (
                <PaymentRowItem key={p.id} payment={p} payments={payments} canRefund={canRefund} />
            ))}
        </DetailSection>
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
        Alert.alert(strings.billing.refundTitle, strings.billing.refundConfirm, [
            { text: strings.common.cancel, style: "cancel" },
            {
                text: strings.billing.refund,
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
                    {isRefund ? strings.billing.refundBadge : payment.method}
                </Text>
                <StatusPill status={payment.status} intent={paymentStatusIntent(payment.status)} />
                {showRefund ? (
                    <View style={styles.refund}>
                        <TextField
                            type="number"
                            size="sm"
                            width="narrow"
                            name={strings.billing.refund}
                            value={amount}
                            onChange={setAmount}
                            placeholder={refundPlaceholder(remainingCents)}
                        />
                        <Button variant="outline" size="sm" busy={busy} onPress={refund}>
                            {busy ? strings.billing.refundingShort : strings.billing.refund}
                        </Button>
                    </View>
                ) : null}
            </View>
            {error !== null ? <Notice tone="danger">{error}</Notice> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    row: { flexDirection: "row", alignItems: "center" },
    rowMain: { flex: 1 },
    rowName: { color: c.ink, fontSize: 15, fontWeight: "700" },
    rowSub: { color: c.muted, fontSize: 13, marginTop: 1 },
    rowRight: { alignItems: "flex-end", gap: 4 },
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
    refund: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 6 },
    lineRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 8,
        borderBottomColor: c.border,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    lineDesc: { color: c.ink, fontSize: 14, flex: 1 },
    totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 12 },
    taxRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: 8 },
    totalLabel: { color: c.muted, fontSize: 14 },
});
