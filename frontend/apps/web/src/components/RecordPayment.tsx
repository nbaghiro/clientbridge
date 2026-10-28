import {
    type DocTotalLine,
    type InvoiceRecord,
    type TenderKey,
    formatMoney,
    strings,
    usePaymentRecorder,
    BUSINESS_CURRENCY,
    useBusinessZone,
    currencyAffix,
    formatAmountInput,
} from "@clientbridge/app-core";
import {
    Button,
    Checkbox,
    Choice,
    DocTotals,
    Empty,
    IconButton,
    Notice,
    TextField,
    DateField,
} from "@clientbridge/ui";

import { api } from "../lib/api";

const r = strings.billing.rec;

/** Recording a payment in place of the invoice's details, its total and button pinned at the bottom. */
export function RecordPayment({ rec, onClose }: { rec: InvoiceRecord; onClose: () => void }) {
    const zone = useBusinessZone();
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
        <section
            aria-label={r.title}
            className="flex h-full min-h-0 flex-col bg-surface @4xl:border-r @4xl:border-line"
        >
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
                <div className="flex min-w-0 items-start gap-2">
                    <IconButton
                        size="sm"
                        icon="chevronLeft"
                        label={strings.billing.backToInvoice}
                        onPress={onClose}
                    />
                    <div className="min-w-0">
                        <h2 className="font-display text-lg font-bold text-ink">{r.title}</h2>
                        <p className="mt-0.5 truncate text-sm text-muted">
                            {r.subtitle(rec.row.client_name ?? "", rec.title)}
                        </p>
                    </div>
                </div>
                <div className="shrink-0 text-right">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">
                        {strings.billing.balanceDue}
                    </p>
                    <p className="font-display text-lg font-bold tabular-nums text-ink">
                        {formatMoney(pay.balanceCents, BUSINESS_CURRENCY)}
                    </p>
                </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                {pay.done !== null ? (
                    <div>
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
                    <div>
                        <Empty variant="card" icon="checkCircle" message={r.nothingOwed} />
                    </div>
                ) : (
                    <div className="space-y-5">
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
                                    <TextField
                                        name={r.amount}
                                        width="narrow"
                                        {...currencyAffix(BUSINESS_CURRENCY)}
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
                                    {...currencyAffix(BUSINESS_CURRENCY)}
                                    value={pay.tendered}
                                    placeholder={formatAmountInput(
                                        pay.amountCents,
                                        BUSINESS_CURRENCY,
                                    )}
                                    error={pay.tenderedError}
                                    onChange={pay.setTendered}
                                />
                                <Notice tone="success" banner>
                                    {r.change}{" "}
                                    <strong>
                                        {pay.changeCents > 0
                                            ? formatMoney(pay.changeCents, BUSINESS_CURRENCY)
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
                                        pay.method === "etransfer"
                                            ? r.referencePlaceholder
                                            : undefined
                                    }
                                    value={pay.reference}
                                    onChange={pay.setReference}
                                />
                                <DateField
                                    zone={zone}
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
                    </div>
                )}
            </div>
            {pay.done === null && pay.balanceCents > 0 ? (
                <div className="space-y-3 border-t border-line bg-surface px-5 pb-5 pt-3.5">
                    <DocTotals currency={BUSINESS_CURRENCY} lines={summary} density="compact" />
                    {pay.error !== null ? <Notice tone="danger">{pay.error}</Notice> : null}
                    <Button size="lg" full busy={pay.busy} onPress={pay.submit}>
                        {pay.submitLabel}
                    </Button>
                </div>
            ) : null}
        </section>
    );
}
