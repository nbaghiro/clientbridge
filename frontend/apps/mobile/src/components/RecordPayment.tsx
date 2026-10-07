import {
    type DocTotalLine,
    type InvoiceRecord,
    type TenderKey,
    formatMoney,
    strings,
    usePaymentRecorder,
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
        clientEmail: rec.row.client_email,
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
            <View style={styles.head}>
                <View style={styles.headMain}>
                    <Text style={styles.title}>{r.title}</Text>
                    <Text style={styles.sub}>
                        {r.subtitle(rec.row.client_name ?? "", rec.title)}
                    </Text>
                </View>
                <View style={styles.headRight}>
                    <Text style={styles.caps}>{strings.billing.balanceDue}</Text>
                    <Text style={styles.balance}>{formatMoney(pay.balanceCents)}</Text>
                </View>
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
                                    label: r.fullBalance(formatMoney(pay.balanceCents)),
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
                                    prefix="$"
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
                                    prefix="$"
                                    type="number"
                                    value={pay.tendered}
                                    error={pay.tenderedError}
                                    onChange={pay.setTendered}
                                />
                                <Notice tone="success" banner>
                                    {`${r.change} ${pay.changeCents > 0 ? formatMoney(pay.changeCents) : r.noChange}`}
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
                            <DocTotals lines={summary} density="compact" />
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
    head: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 12 },
    headMain: { flex: 1 },
    headRight: { alignItems: "flex-end" },
    title: { fontSize: 19, fontWeight: "700", color: c.ink },
    sub: { fontSize: 13, color: c.muted, marginTop: 2 },
    caps: { fontSize: 11, fontWeight: "600", letterSpacing: 0.5, color: c.muted },
    balance: { fontSize: 19, fontWeight: "700", color: c.ink },
    body: { flexGrow: 0 },
    label: { fontSize: 14, fontWeight: "600", color: c.ink, marginBottom: 8 },
    space: { marginTop: 14, gap: 10 },
    summary: { borderRadius: 10, backgroundColor: c.bg, padding: 12 },
    footer: { flexDirection: "row", gap: 10, paddingTop: 12, marginTop: 8 },
});
