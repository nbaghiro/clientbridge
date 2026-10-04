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
    refundPlaceholder,
    useDocTotals,
    useLines,
    useSearch,
} from "@clientbridge/app-core";
import { StatusPill } from "@clientbridge/ui";
import { useState } from "react";

import { DocEditor } from "../components/DocEditor";
import { DetailSection, DetailView } from "../components/DetailView";
import { ListPage } from "../components/ListPage";
import { Money } from "../components/Money";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";

const GRID = "grid grid-cols-[6rem_2fr_1fr_1fr] items-center gap-4";

export function Invoices() {
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
    const noun = tab === "invoices" ? "invoice" : "estimate";
    const intent = tab === "invoices" ? invoiceStatusIntent : estimateStatusIntent;

    return (
        <div>
            <ListPage
                summary={strings.invoices.countSummary(invoices.length, estimates.length)}
                action={{
                    label: strings.invoices.newButton(noun),
                    onPress: () => {
                        setCreating(true);
                    },
                }}
                segments={{ items: DOC_TABS, active: tab, onSelect: setTab }}
                search={{
                    value: q,
                    onChange: setQ,
                    placeholder: strings.invoices.searchPlaceholder(tab),
                }}
                head={
                    <div className={GRID}>
                        <span>{strings.invoices.colNumber}</span>
                        <span>{strings.invoices.colClient}</span>
                        <span>{strings.invoices.colStatus}</span>
                        <span className="text-right">{strings.invoices.colTotal}</span>
                    </div>
                }
                rows={filtered}
                rowKey={(r) => r.id}
                onRowPress={(r) => {
                    setOpenId(r.id);
                }}
                empty={q ? strings.invoices.searchEmpty(tab) : strings.invoices.empty(tab)}
                renderRow={(r) => (
                    <div className={GRID}>
                        <span className="font-medium tabular-nums text-ink">
                            {r.number ?? strings.clients.dash}
                        </span>
                        <span className="truncate text-ink">
                            {r.client_name ?? strings.clients.dash}
                        </span>
                        <span>
                            <StatusPill status={r.status} intent={intent(r.status)} />
                        </span>
                        <span className="text-right">
                            <Money cents={r.total_cents} />
                        </span>
                    </div>
                )}
            />

            {creating ? (
                <DocEditor
                    kind={tab === "invoices" ? "invoice" : "estimate"}
                    onClose={() => {
                        setCreating(false);
                    }}
                />
            ) : null}
            {openId !== null ? (
                <DocDetail
                    kind={tab}
                    row={filtered.find((r) => r.id === openId) ?? null}
                    onClose={() => {
                        setOpenId(null);
                    }}
                />
            ) : null}
        </div>
    );
}

function DocDetail({
    kind,
    row,
    onClose,
}: {
    kind: DocTab;
    row: InvoiceRow | EstimateRow | null;
    onClose: () => void;
}) {
    const parentType = kind === "invoices" ? "invoice" : "estimate";
    const lines = useLines(parentType, row?.id ?? "");
    const totals = useDocTotals(parentType, row);
    const { busy, error, run } = useAsyncAction();
    const role = useRole();
    const [editing, setEditing] = useState(false);

    if (row === null) return null;
    const isInvoice = kind === "invoices";
    if (editing) {
        return (
            <DocEditor
                kind={isInvoice ? "invoice" : "estimate"}
                draft={docDraft(row, lines)}
                onClose={() => {
                    setEditing(false);
                }}
            />
        );
    }
    const canRefund = canManagePayments(role);
    const actions = isInvoice
        ? invoiceActions(api, row as InvoiceRow)
        : estimateActions(api, row as EstimateRow);
    const payToken = isInvoice ? (row as InvoiceRow).pay_token : null;
    const canPay = isInvoice && isPayable(row as InvoiceRow);

    return (
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
                        <button
                            type="button"
                            onClick={() => {
                                setEditing(true);
                            }}
                            className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition hover:bg-bg"
                        >
                            {strings.invoices.edit}
                        </button>
                    ) : null}
                    {actions.map((a) => (
                        <button
                            key={a.key}
                            type="button"
                            disabled={busy}
                            onClick={() => {
                                run(a.run, {
                                    onSuccess: onClose,
                                    errorMessage: strings.invoices.actionError(
                                        DOC_ACTION_LABEL[a.key].toLowerCase(),
                                    ),
                                });
                            }}
                            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                        >
                            {DOC_ACTION_LABEL[a.key]}
                        </button>
                    ))}
                </>
            }
        >
            <DetailSection>
                <div className="divide-y divide-line-soft text-sm">
                    {lines.map((l) => (
                        <div key={l.id} className="flex items-center gap-4 py-2">
                            <span className="flex-1 text-ink">{l.description}</span>
                            <span className="tabular-nums text-muted">
                                {l.quantity} × {formatMoney(l.unit_amount_cents)}
                            </span>
                            <span className="w-24 text-right">
                                <Money cents={l.amount_cents} />
                            </span>
                        </div>
                    ))}
                </div>
                <div className="mt-4 space-y-1 text-sm">
                    {totals.map((t) => (
                        <div key={t.key} className="flex justify-end gap-4 text-muted">
                            <span className={t.strong ? "text-ink" : undefined}>{t.label}</span>
                            <span className="w-24 text-right">
                                <Money cents={t.cents} strong={t.strong} />
                            </span>
                        </div>
                    ))}
                </div>
            </DetailSection>
            {canPay && payToken !== null ? <PayLink token={payToken} /> : null}
            {isInvoice ? <PaymentsSection invoiceId={row.id} canRefund={canRefund} /> : null}
            {error !== null ? <p className="text-sm text-danger">{error}</p> : null}
        </DetailView>
    );
}

function PayLink({ token }: { token: string }) {
    const url = payLinkUrl(window.location.origin, token);
    const [copied, setCopied] = useState(false);

    const copy = (): void => {
        navigator.clipboard
            .writeText(url)
            .then(() => {
                setCopied(true);
                window.setTimeout(() => {
                    setCopied(false);
                }, 1500);
            })
            .catch(() => undefined);
    };

    return (
        <DetailSection title={strings.invoices.payLink}>
            <div className="flex items-center gap-2 rounded-md border border-line bg-bg px-3 py-2.5">
                <span className="flex-1 truncate text-sm text-ink-soft">{url}</span>
                <button
                    type="button"
                    onClick={copy}
                    className="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink-soft transition hover:bg-surface"
                >
                    {copied ? strings.invoices.copied : strings.invoices.copy}
                </button>
            </div>
        </DetailSection>
    );
}

function PaymentsSection({ invoiceId, canRefund }: { invoiceId: string; canRefund: boolean }) {
    const payments = useInvoicePayments(invoiceId);
    if (payments.length === 0) return null;

    return (
        <DetailSection title={strings.invoices.payments}>
            <div className="divide-y divide-line-soft rounded-md border border-line">
                {payments.map((p) => (
                    <PaymentRowItem
                        key={p.id}
                        payment={p}
                        payments={payments}
                        canRefund={canRefund}
                    />
                ))}
            </div>
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
        if (!window.confirm(strings.invoices.refundConfirm)) return;
        submit();
    };

    return (
        <div className="px-3 py-2 text-sm">
            <div className="flex items-center gap-3">
                <span
                    className={`font-medium tabular-nums ${isRefund ? "text-danger" : "text-ink"}`}
                >
                    {isRefund ? "−" : ""}
                    {formatMoneyWithCurrency(payment.amount_cents, payment.currency)}
                </span>
                {isRefund ? (
                    <span className="rounded-full bg-bg px-2 py-0.5 text-xs font-medium text-muted">
                        {strings.invoices.refundBadge}
                    </span>
                ) : (
                    <span className="capitalize text-muted">{payment.method}</span>
                )}
                <StatusPill status={payment.status} intent={paymentStatusIntent(payment.status)} />
                {showRefund ? (
                    <input
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => {
                            setAmount(e.target.value);
                        }}
                        placeholder={refundPlaceholder(remainingCents)}
                        className="ml-auto w-32 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink outline-hidden focus:border-accent"
                    />
                ) : null}
                {showRefund ? (
                    <button
                        type="button"
                        disabled={busy}
                        onClick={refund}
                        className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink-soft transition hover:bg-bg disabled:opacity-60"
                    >
                        {busy ? strings.invoices.refunding : strings.invoices.refund}
                    </button>
                ) : null}
            </div>
            {error !== null ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
        </div>
    );
}
