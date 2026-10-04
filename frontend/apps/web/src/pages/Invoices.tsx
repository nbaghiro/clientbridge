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
import { StatusPill } from "@clientbridge/ui";
import { useState } from "react";

import { DocEditor } from "../components/DocEditor";
import { IconPlus, IconSearch } from "../components/icons";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";

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

    return (
        <div>
            <header className="flex items-center justify-between gap-4">
                <p className="text-sm text-muted">
                    {strings.invoices.countSummary(invoices.length, estimates.length)}
                </p>
                <button
                    type="button"
                    onClick={() => {
                        setCreating(true);
                    }}
                    className="flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90"
                >
                    <IconPlus className="h-4 w-4" /> {strings.invoices.newButton(noun)}
                </button>
            </header>

            <div className="mt-6 flex gap-1 rounded-md border border-line bg-surface p-1 text-sm font-medium">
                {(["invoices", "estimates"] as const).map((t) => (
                    <button
                        key={t}
                        type="button"
                        onClick={() => {
                            setTab(t);
                        }}
                        className={`flex-1 rounded-base px-3 py-1.5 capitalize transition ${
                            tab === t ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"
                        }`}
                    >
                        {t}
                    </button>
                ))}
            </div>

            <div className="relative mt-4">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                    value={q}
                    onChange={(e) => {
                        setQ(e.target.value);
                    }}
                    placeholder={strings.invoices.searchPlaceholder(tab)}
                    className="w-full rounded-md border border-line bg-surface py-2.5 pl-9 pr-3 text-sm outline-hidden placeholder:text-muted focus:border-accent"
                />
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-line bg-surface">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                            <th className="px-4 py-3 font-semibold">
                                {strings.invoices.colNumber}
                            </th>
                            <th className="px-4 py-3 font-semibold">
                                {strings.invoices.colClient}
                            </th>
                            <th className="px-4 py-3 font-semibold">
                                {strings.invoices.colStatus}
                            </th>
                            <th className="px-4 py-3 text-right font-semibold">
                                {strings.invoices.colTotal}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map((r) => (
                            <tr
                                key={r.id}
                                onClick={() => {
                                    setOpenId(r.id);
                                }}
                                className="cursor-pointer border-b border-line-soft transition last:border-0 hover:bg-bg"
                            >
                                <td className="px-4 py-3 font-medium tabular-nums text-ink">
                                    {r.number ?? "—"}
                                </td>
                                <td className="px-4 py-3 text-ink">{r.client_name ?? "—"}</td>
                                <td className="px-4 py-3">
                                    <StatusPill
                                        status={r.status}
                                        intent={
                                            tab === "invoices"
                                                ? invoiceStatusIntent(r.status)
                                                : estimateStatusIntent(r.status)
                                        }
                                    />
                                </td>
                                <td className="px-4 py-3 text-right font-medium tabular-nums text-ink">
                                    {formatMoney(r.total_cents)}
                                </td>
                            </tr>
                        ))}
                        {filtered.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={4}
                                    className="px-4 py-12 text-center text-sm text-muted"
                                >
                                    {q
                                        ? strings.invoices.searchEmpty(tab)
                                        : strings.invoices.empty(tab)}
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>

            {creating ? (
                <DocEditor
                    kind={tab === "invoices" ? "invoice" : "estimate"}
                    onClose={() => {
                        setCreating(false);
                    }}
                />
            ) : null}
            {openId !== null ? (
                <DetailModal
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

function Overlay({ children }: { children: React.ReactNode }) {
    return (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-scrim p-4">
            {children}
        </div>
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
        <Overlay>
            <div className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-lg border border-line bg-surface shadow-card">
                <div className="flex items-start justify-between border-b border-line px-6 py-4">
                    <div>
                        <h2 className="font-display text-lg font-bold text-ink">
                            {isInvoice
                                ? strings.invoices.invoiceHeading
                                : strings.invoices.estimateHeading}{" "}
                            {row.number !== null ? `#${row.number}` : strings.invoices.draftHeading}
                        </h2>
                        <p className="mt-0.5 text-sm text-muted">{row.client_name ?? "—"}</p>
                    </div>
                    <StatusPill
                        status={row.status}
                        intent={
                            isInvoice
                                ? invoiceStatusIntent(row.status)
                                : estimateStatusIntent(row.status)
                        }
                    />
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-4">
                    <table className="w-full text-sm">
                        <tbody>
                            {lines.map((l) => (
                                <tr key={l.id} className="border-b border-line-soft last:border-0">
                                    <td className="py-2 text-ink">{l.description}</td>
                                    <td className="py-2 text-right tabular-nums text-muted">
                                        {l.quantity} × {formatMoney(l.unit_amount_cents)}
                                    </td>
                                    <td className="py-2 pl-4 text-right font-medium tabular-nums text-ink">
                                        {formatMoney(l.amount_cents)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="mt-4 flex justify-end">
                        <span className="text-sm text-muted">
                            {strings.invoices.total}{" "}
                            <span className="font-semibold text-ink">
                                {formatMoney(row.total_cents)}
                            </span>
                        </span>
                    </div>
                    {canPay && payToken !== null ? <PayLink token={payToken} /> : null}
                    {isInvoice ? (
                        <PaymentsSection invoiceId={row.id} canRefund={canRefund} />
                    ) : null}
                </div>
                {error !== null ? (
                    <p className="border-t border-line px-6 pt-3 text-sm text-danger">{error}</p>
                ) : null}
                <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-bg"
                    >
                        {strings.common.close}
                    </button>
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
                </div>
            </div>
        </Overlay>
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
        <div className="mt-4 rounded-md border border-line bg-bg px-3 py-2.5">
            <p className="text-xs uppercase tracking-wide text-muted">{strings.invoices.payLink}</p>
            <div className="mt-1.5 flex items-center gap-2">
                <span className="flex-1 truncate text-sm text-ink-soft">{url}</span>
                <button
                    type="button"
                    onClick={copy}
                    className="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink-soft transition hover:bg-surface"
                >
                    {copied ? strings.invoices.copied : strings.invoices.copy}
                </button>
            </div>
        </div>
    );
}

function PaymentsSection({ invoiceId, canRefund }: { invoiceId: string; canRefund: boolean }) {
    const payments = useInvoicePayments(invoiceId);
    if (payments.length === 0) return null;

    return (
        <div className="mt-4">
            <p className="text-xs uppercase tracking-wide text-muted">
                {strings.invoices.payments}
            </p>
            <div className="mt-1.5 divide-y divide-line-soft rounded-md border border-line">
                {payments.map((p) => (
                    <PaymentRowItem
                        key={p.id}
                        payment={p}
                        payments={payments}
                        canRefund={canRefund}
                    />
                ))}
            </div>
        </div>
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
                        placeholder={strings.invoices.refundAmountPlaceholder(
                            formatMoneyWithCurrency(remainingCents, payment.currency),
                        )}
                        className="ml-auto w-28 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink outline-hidden focus:border-accent"
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
