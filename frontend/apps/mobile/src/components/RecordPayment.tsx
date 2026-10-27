import {
    type DocTotalLine,
    type InvoiceRecord,
    type TenderKey,
    formatMoney,
    strings,
    usePaymentRecorder,
    BUSINESS_CURRENCY,
    currencyAffix,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
    Button,
    Checkbox,
    Choice,
    DocTotals,
    Empty,
    Modal,
    Notice,
    SheetHeader,
    TextField,
} from "@clientbridge/ui";

import { api } from "../lib/api";

const c = theme.colors;
const r = strings.billing.rec;

export function RecordPayment({ rec, onClose }: { rec: InvoiceRecord; onClose: () => void }) {
    const pay = usePaymentRecorder(api, {
        invoiceId: rec.row.id,
        label: rec.title,
        clientId: rec.row.client_id,
        clientPhone: rec.row.client_phone,
        balanceCents: rec.balanceCents,
    });
    const summary: DocTotalLine[] = [
        {
            key: "balance",
            label: strings.billing.balanceDue,
            cents: pay.balanceCents,
            kind: "subtotal",
        },
        { key: "this", label: r.thisPayment, cents: pay.amountCents, kind: "credit" },
        { key: "after", label: pay.resultLabel, cents: pay.afterCents, kind: "balance" },
    ];

    return (
        <Modal onClose={onClose} size="xl">
            <SheetHeader
                title={r.title}
                subtitle={r.subtitle(rec.row.client_name ?? "", rec.title)}
            />
            <View style={styles.head}>
                <Text style={styles.caps}>{strings.billing.balanceDue}</Text>
                <Text style={styles.balance}>
                    {formatMoney(pay.balanceCents, BUSINESS_CURRENCY)}
                </Text>
            </View>
            {pay.done !== null ? (
                <Empty
                    variant="card"
                    icon="checkCircle"
                    message={pay.done.title}
                    body={pay.done.lines.join(" ")}
                    actions={
                        <>
                            <Button onPress={onClose}>{strings.common.done}</Button>
                            {!pay.done.paidInFull ? (
                                <Button variant="outline" onPress={pay.reset}>
                                    {r.recordAnother}
                                </Button>
                            ) : null}
                        </>
                    }
                />
            ) : (
                <>
                    <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
                        <Text style={styles.label}>{r.howPaid}</Text>
                        <Choice<TenderKey>
                            layout="tiles"
                            columns={2}
                            label={r.howPaid}
                            options={pay.methods.map((m) => ({
                                key: m.key,
                                label: m.label,
                                hint: m.hint,
                                disabled: m.disabled,
                            }))}
                            value={pay.method}
                            onChange={pay.setMethod}
                        />
                        <Text style={[styles.label, styles.space]}>{r.amount}</Text>
                        <Choice<"full" | "part">
                            layout="segmented"
                            label={r.amount}
                            options={[
                                {
                                    key: "full",
                                    label: r.fullBalance(
                                        formatMoney(pay.balanceCents, BUSINESS_CURRENCY),
                                    ),
                                },
                                { key: "part", label: r.partial },
                            ]}
                            value={pay.amountMode}
                            onChange={pay.setAmountMode}
                        />
                        {pay.amountMode === "part" ? (
                            <View style={styles.space}>
                                <TextField
                                    name={r.amount}
                                    {...currencyAffix(BUSINESS_CURRENCY)}
                                    type="number"
                                    value={pay.amount}
                                    placeholder="0.00"
                                    onChange={pay.setAmount}
                                />
                            </View>
                        ) : null}
                        {pay.amountError !== null ? (
                            <Notice tone="danger">{pay.amountError}</Notice>
                        ) : null}

                        {pay.method === "cash" ? (
                            <View style={styles.space}>
                                <TextField
                                    label={r.tendered}
                                    optional
                                    {...currencyAffix(BUSINESS_CURRENCY)}
                                    type="number"
                                    value={pay.tendered}
                                    error={pay.tenderedError}
                                    onChange={pay.setTendered}
                                />
                                <Notice tone="success" banner>
                                    {strings.common.labelValue(
                                        r.change,
                                        pay.changeCents > 0
                                            ? formatMoney(pay.changeCents, BUSINESS_CURRENCY)
                                            : r.noChange,
                                    )}
                                </Notice>
                            </View>
                        ) : null}

                        {pay.method === "etransfer" || pay.method === "cheque" ? (
                            <View style={styles.space}>
                                <TextField
                                    label={pay.method === "cheque" ? r.chequeNo : r.reference}
                                    optional
                                    hint={pay.method === "etransfer" ? r.referenceHint : undefined}
                                    value={pay.reference}
                                    onChange={pay.setReference}
                                />
                                <TextField
                                    label={r.receivedOn}
                                    value={pay.receivedOn}
                                    placeholder="2026-10-07"
                                    error={pay.dateError}
                                    onChange={pay.setReceivedOn}
                                />
                            </View>
                        ) : null}

                        <View style={styles.space}>
                            <TextField
                                label={r.note}
                                optional
                                value={pay.note}
                                placeholder={r.notePlaceholder}
                                onChange={pay.setNote}
                            />
                        </View>
                        {pay.receiptTo !== null ? (
                            <View style={styles.space}>
                                <Checkbox
                                    label={r.sendReceipt}
                                    value={pay.sendReceipt}
                                    onChange={pay.setSendReceipt}
                                />
                                <Text style={styles.sub}>{r.sendReceiptTo(pay.receiptTo)}</Text>
                            </View>
                        ) : null}
                        <View style={[styles.summary, styles.space]}>
                            <DocTotals
                                currency={BUSINESS_CURRENCY}
                                lines={summary}
                                density="compact"
                            />
                        </View>
                        {pay.error !== null ? <Notice tone="danger">{pay.error}</Notice> : null}
                    </ScrollView>
                    <View style={styles.footer}>
                        <Button variant="quiet" onPress={onClose}>
                            {strings.common.close}
                        </Button>
                        <Button grow busy={pay.busy} onPress={pay.submit}>
                            {pay.submitLabel}
                        </Button>
                    </View>
                </>
            )}
        </Modal>
    );
}

const styles = StyleSheet.create({
    head: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginTop: 8,
        marginBottom: 12,
    },
    sub: { fontFamily: theme.fonts.ui, fontSize: 13, color: c.muted, marginTop: 2 },
    caps: {
        fontFamily: theme.fonts.ui,
        fontSize: 11,
        fontWeight: "600",
        letterSpacing: 0.5,
        color: c.muted,
    },
    balance: { fontFamily: theme.fonts.ui, fontSize: 19, fontWeight: "700", color: c.ink },
    body: { flexGrow: 0 },
    label: {
        fontFamily: theme.fonts.ui,
        fontSize: 14,
        fontWeight: "600",
        color: c.ink,
        marginBottom: 8,
    },
    space: { marginTop: 14, gap: 10 },
    summary: { borderRadius: 10, backgroundColor: c.bg, padding: 12 },
    footer: { flexDirection: "row", gap: 10, paddingTop: 12, marginTop: 8 },
});
