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
    useClients,
    useDocForm,
    useEstimates,
    useInvoices,
    useLines,
    useSearch,
} from "@clientbridge/app-core";
import { useState } from "react";

import { IconPlus, IconSearch } from "../components/icons";
import { StatusPill } from "../components/StatusPill";
import { api } from "../lib/api";

type Tab = "invoices" | "estimates";

const ACTION_LABELS: Record<DocActionKey, string> = {
    send: "Send",
    void: "Void",
    accept: "Accept",
    decline: "Decline",
    convert: "Convert to invoice",
};

export function Invoices() {
    const invoices = useInvoices();
    const estimates = useEstimates();
    const [tab, setTab] = useState<Tab>("invoices");
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
        <div className="mx-auto max-w-5xl px-8 py-8">
            <header className="flex items-center justify-between gap-4">
                <div>
                    <h1 className="font-display text-2xl font-bold">Billing</h1>
                    <p className="mt-0.5 text-sm text-muted">
                        {invoices.length} invoices · {estimates.length} estimates
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        setCreating(true);
                    }}
                    className="flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90"
                >
                    <IconPlus className="h-4 w-4" /> New {noun}
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
                        className={`flex-1 rounded px-3 py-1.5 capitalize transition ${
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
                    placeholder={`Search ${tab}…`}
                    className="w-full rounded-md border border-line bg-surface py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-muted focus:border-accent"
                />
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-line bg-surface">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                            <th className="px-4 py-3 font-semibold">#</th>
                            <th className="px-4 py-3 font-semibold">Client</th>
                            <th className="px-4 py-3 font-semibold">Status</th>
                            <th className="px-4 py-3 text-right font-semibold">Total</th>
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
                                    {q ? `No ${tab} match your search.` : `No ${tab} yet.`}
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>

            {creating ? (
                <NewDocModal
                    kind={tab}
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
        <div
            className="fixed inset-0 z-20 flex items-center justify-center p-4"
            style={{ backgroundColor: "rgba(20,25,30,0.35)" }}
        >
            {children}
        </div>
    );
}

const field =
    "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-accent";

function NewDocModal({ kind, onClose }: { kind: Tab; onClose: () => void }) {
    const clients = useClients();
    const form = useDocForm(api, kind === "invoices" ? "invoice" : "estimate", onClose);

    return (
        <Overlay>
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    form.submit();
                }}
                className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-lg border border-line bg-surface shadow-card"
            >
                <h2 className="border-b border-line px-6 py-4 font-display text-lg font-bold text-ink">
                    New {kind === "invoices" ? "invoice" : "estimate"}
                </h2>
                <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
                    <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                        Client
                        <select
                            value={form.clientId}
                            onChange={(e) => {
                                form.setClientId(e.target.value);
                            }}
                            className={field}
                        >
                            <option value="">Select a client</option>
                            {clients.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                    </label>

                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted">
                            <span className="flex-1">Description</span>
                            <span className="w-12 text-center">Qty</span>
                            <span className="w-20 text-right">Price</span>
                            <span className="w-5" />
                        </div>
                        {form.lines.map((l) => (
                            <div key={l.key} className="flex items-center gap-2">
                                <input
                                    value={l.description}
                                    onChange={(e) => {
                                        form.setLine(l.key, { description: e.target.value });
                                    }}
                                    placeholder="Service or item"
                                    className={`${field} flex-1`}
                                />
                                <input
                                    value={l.quantity}
                                    onChange={(e) => {
                                        form.setLine(l.key, { quantity: e.target.value });
                                    }}
                                    inputMode="decimal"
                                    className={`${field} w-12 text-center`}
                                />
                                <input
                                    value={l.unit}
                                    onChange={(e) => {
                                        form.setLine(l.key, { unit: e.target.value });
                                    }}
                                    inputMode="decimal"
                                    placeholder="0.00"
                                    className={`${field} w-20 text-right`}
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        form.removeLine(l.key);
                                    }}
                                    className="w-5 text-muted transition hover:text-danger"
                                    aria-label="Remove line"
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                        <button
                            type="button"
                            onClick={() => {
                                form.addLine();
                            }}
                            className="text-sm font-medium text-accent transition hover:opacity-80"
                        >
                            + Add line
                        </button>
                    </div>

                    <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                        Notes
                        <textarea
                            value={form.notes}
                            onChange={(e) => {
                                form.setNotes(e.target.value);
                            }}
                            rows={2}
                            className={field}
                        />
                    </label>
                    {form.error ? <p className="text-sm text-danger">{form.error}</p> : null}
                </div>
                <div className="flex items-center justify-between border-t border-line px-6 py-4">
                    <span className="text-sm text-muted">
                        Subtotal{" "}
                        <span className="font-semibold text-ink">
                            {formatMoney(form.subtotalCents)}
                        </span>
                        <span className="text-xs"> + tax</span>
                    </span>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-bg"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={form.busy}
                            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                        >
                            {form.busy ? "Saving…" : "Save draft"}
                        </button>
                    </div>
                </div>
            </form>
        </Overlay>
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

    if (row === null) return null;
    const isInvoice = kind === "invoices";

    const actions = isInvoice
        ? invoiceActions(api, row as InvoiceRow)
        : estimateActions(api, row as EstimateRow);

    const payToken = isInvoice ? (row as InvoiceRow).pay_token : null;
    const canPay = row.status !== "draft" && row.status !== "void";

    return (
        <Overlay>
            <div className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-lg border border-line bg-surface shadow-card">
                <div className="flex items-start justify-between border-b border-line px-6 py-4">
                    <div>
                        <h2 className="font-display text-lg font-bold text-ink">
                            {isInvoice ? "Invoice" : "Estimate"}{" "}
                            {row.number !== null ? `#${row.number}` : "(draft)"}
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
                            Total{" "}
                            <span className="font-semibold text-ink">
                                {formatMoney(row.total_cents)}
                            </span>
                        </span>
                    </div>
                    {canPay && payToken !== null ? <PayLink token={payToken} /> : null}
                </div>
                <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-bg"
                    >
                        Close
                    </button>
                    {actions.map((a) => (
                        <button
                            key={a.key}
                            type="button"
                            disabled={busy}
                            onClick={() => void run(a.run, { onSuccess: onClose })}
                            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                        >
                            {ACTION_LABELS[a.key]}
                        </button>
                    ))}
                </div>
            </div>
        </Overlay>
    );
}

function PayLink({ token }: { token: string }) {
    const url = `${window.location.origin}/pay/${token}`;
    const [copied, setCopied] = useState(false);

    const copy = (): void => {
        void navigator.clipboard.writeText(url).then(() => {
            setCopied(true);
            window.setTimeout(() => {
                setCopied(false);
            }, 1500);
        });
    };

    return (
        <div className="mt-4 rounded-md border border-line bg-bg px-3 py-2.5">
            <p className="text-xs uppercase tracking-wide text-muted">Pay link</p>
            <div className="mt-1.5 flex items-center gap-2">
                <span className="flex-1 truncate text-sm text-ink-soft">{url}</span>
                <button
                    type="button"
                    onClick={copy}
                    className="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink-soft transition hover:bg-surface"
                >
                    {copied ? "Copied" : "Copy"}
                </button>
            </div>
        </div>
    );
}
