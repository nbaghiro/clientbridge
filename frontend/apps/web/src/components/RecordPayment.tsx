import {
    type DocTotalLine,
    type InvoiceRecord,
    type TenderKey,
    formatMoney,
    strings,
    usePaymentRecorder,
} from "@clientbridge/app-core";
import {
    Button,
    Checkbox,
    Choice,
    DocTotals,
    Empty,
    Modal,
    Notice,
    TextField,
    DateField,
} from "@clientbridge/ui";

import { api } from "../lib/api";

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
        <Modal onClose={onClose} size="lg">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="font-display text-xl font-bold text-ink">{r.title}</h2>
                    <p className="mt-0.5 text-sm text-muted">
                        {r.subtitle(rec.row.client_name ?? "", rec.title)}
                    </p>
                </div>
                <div className="text-right">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">
                        {strings.billing.balanceDue}
                    </p>
                    <p className="font-display text-xl font-bold tabular-nums text-ink">
                        {formatMoney(pay.balanceCents)}
                    </p>
                </div>
            </div>

            {pay.done !== null ? (
                <div className="mt-6">
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
                </div>
            ) : pay.balanceCents <= 0 ? (
                <div className="mt-6">
                    <Empty variant="card" icon="checkCircle" message={r.nothingOwed} />
                </div>
            ) : (
                <div className="mt-5 space-y-5">
                    <div>
                        <p className="mb-2 text-sm font-medium text-ink">{r.howPaid}</p>
                        <Choice<TenderKey>
                            layout="tiles"
                            columns={3}
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
                    </div>

                    <div>
                        <p className="mb-2 text-sm font-medium text-ink">{r.amount}</p>
                        <div className="flex flex-wrap items-center gap-3">
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
                                <TextField
                                    name={r.amount}
                                    width="narrow"
                                    prefix="$"
                                    value={pay.amount}
                                    placeholder="0.00"
                                    autoFocus
                                    onChange={pay.setAmount}
                                />
                            ) : null}
                        </div>
                        {pay.amountError !== null ? (
                            <Notice tone="danger">{pay.amountError}</Notice>
                        ) : null}
                    </div>

                    {pay.method === "cash" ? (
                        <div className="grid grid-cols-2 items-end gap-4">
                            <TextField
                                label={r.tendered}
                                optional
                                prefix="$"
                                value={pay.tendered}
                                placeholder={formatMoney(pay.amountCents).replace("$", "")}
                                error={pay.tenderedError}
                                onChange={pay.setTendered}
                            />
                            <Notice tone="success" banner>
                                {r.change}{" "}
                                <strong>
                                    {pay.changeCents > 0
                                        ? formatMoney(pay.changeCents)
                                        : r.noChange}
                                </strong>
                            </Notice>
                        </div>
                    ) : null}

                    {pay.method === "etransfer" || pay.method === "cheque" ? (
                        <div className="grid grid-cols-2 gap-4">
                            <TextField
                                label={pay.method === "cheque" ? r.chequeNo : r.reference}
                                optional
                                hint={pay.method === "etransfer" ? r.referenceHint : undefined}
                                placeholder={
                                    pay.method === "etransfer" ? r.referencePlaceholder : undefined
                                }
                                value={pay.reference}
                                onChange={pay.setReference}
                            />
                            <DateField
                                label={r.receivedOn}
                                value={pay.receivedOn}
                                error={pay.dateError}
                                onChange={pay.setReceivedOn}
                            />
                        </div>
                    ) : null}

                    <TextField
                        label={r.note}
                        optional
                        value={pay.note}
                        placeholder={r.notePlaceholder}
                        onChange={pay.setNote}
                    />

                    {pay.receiptTo !== null ? (
                        <div>
                            <Checkbox
                                label={r.sendReceipt}
                                value={pay.sendReceipt}
                                onChange={pay.setSendReceipt}
                            />
                            <p className="ml-7 text-xs text-muted">
                                {r.sendReceiptTo(pay.receiptTo)}
                            </p>
                        </div>
                    ) : null}

                    <div className="rounded-lg border border-line bg-bg px-4 py-3">
                        <DocTotals lines={summary} density="compact" />
                    </div>

                    {pay.error !== null ? <Notice tone="danger">{pay.error}</Notice> : null}

                    <div className="flex justify-end gap-3 border-t border-line pt-4">
                        <Button variant="quiet" onPress={onClose}>
                            {strings.common.close}
                        </Button>
                        <Button busy={pay.busy} onPress={pay.submit}>
                            {pay.submitLabel}
                        </Button>
                    </div>
                </div>
            )}
        </Modal>
    );
}
