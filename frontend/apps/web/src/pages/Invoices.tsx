import {
    type CalendarIntent,
    type EstimateRow,
    type InvoiceRow,
    type LineInput,
    acceptEstimate,
    convertEstimate,
    createEstimate,
    createInvoice,
    declineEstimate,
    estimateStatusIntent,
    filterEstimates,
    filterInvoices,
    formatMoney,
    invoiceStatusIntent,
    sendEstimate,
    sendInvoice,
    useClients,
    useEstimates,
    useInvoices,
    useLines,
    voidInvoice,
} from "@clientbridge/app-core";
import { type FormEvent, useMemo, useState } from "react";

import { IconPlus, IconSearch } from "../components/icons";
import { api } from "../lib/api";

type Tab = "invoices" | "estimates";

const INTENT_BADGE: Record<CalendarIntent, string> = {
    accent: "bg-accent-weak text-accent-strong",
    success: "bg-ok-bg text-ok-fg",
    warning: "bg-warn-bg text-warn-fg",
    danger: "bg-surface text-danger",
    neutral: "bg-bg text-muted",
};

function StatusPill({ status, intent }: { status: string; intent: CalendarIntent }) {
    return (
        <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${INTENT_BADGE[intent]}`}
        >
            {status}
        </span>
    );
}

export function Invoices() {
    const invoices = useInvoices();
    const estimates = useEstimates();
    const [tab, setTab] = useState<Tab>("invoices");
    const [q, setQ] = useState("");
    const [creating, setCreating] = useState(false);
    const [openId, setOpenId] = useState<string | null>(null);

    const rows = useMemo(
        () => (tab === "invoices" ? filterInvoices(invoices, q) : filterEstimates(estimates, q)),
        [tab, invoices, estimates, q],
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
                        {rows.map((r) => (
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
                        {rows.length === 0 ? (
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
                    row={rows.find((r) => r.id === openId) ?? null}
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

interface DraftLine {
    key: string;
    description: string;
    quantity: string;
    unit: string;
}

let lineSeq = 0;
const blankLine = (): DraftLine => ({
    key: `l${(lineSeq += 1)}`,
    description: "",
    quantity: "1",
    unit: "",
});

const field =
    "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-accent";

function NewDocModal({ kind, onClose }: { kind: Tab; onClose: () => void }) {
    const clients = useClients();
    const [clientId, setClientId] = useState("");
    const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
    const [notes, setNotes] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const setLine = (key: string, patch: Partial<DraftLine>): void => {
        setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    };

    const toInputs = (): LineInput[] =>
        lines
            .filter((l) => l.description.trim().length > 0)
            .map((l) => ({
                description: l.description.trim(),
                quantity: Number(l.quantity) || 0,
                unit_amount_cents: Math.round((Number(l.unit) || 0) * 100),
            }));

    const subtotal = toInputs().reduce(
        (s, l) => s + Math.round(l.quantity * l.unit_amount_cents),
        0,
    );

    const submit = async (e: FormEvent): Promise<void> => {
        e.preventDefault();
        const payload = toInputs();
        if (clientId.length === 0 || payload.length === 0) {
            setError("Pick a client and add at least one line.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            if (kind === "invoices") await createInvoice(api, clientId, payload, notes);
            else await createEstimate(api, clientId, payload, notes);
            onClose();
        } catch {
            setError("Could not save — please try again.");
            setBusy(false);
        }
    };

    return (
        <Overlay>
            <form
                onSubmit={(e) => void submit(e)}
                className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-lg border border-line bg-surface shadow-card"
            >
                <h2 className="border-b border-line px-6 py-4 font-display text-lg font-bold text-ink">
                    New {kind === "invoices" ? "invoice" : "estimate"}
                </h2>
                <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
                    <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                        Client
                        <select
                            value={clientId}
                            onChange={(e) => {
                                setClientId(e.target.value);
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
                        {lines.map((l) => (
                            <div key={l.key} className="flex items-center gap-2">
                                <input
                                    value={l.description}
                                    onChange={(e) => {
                                        setLine(l.key, { description: e.target.value });
                                    }}
                                    placeholder="Service or item"
                                    className={`${field} flex-1`}
                                />
                                <input
                                    value={l.quantity}
                                    onChange={(e) => {
                                        setLine(l.key, { quantity: e.target.value });
                                    }}
                                    inputMode="decimal"
                                    className={`${field} w-12 text-center`}
                                />
                                <input
                                    value={l.unit}
                                    onChange={(e) => {
                                        setLine(l.key, { unit: e.target.value });
                                    }}
                                    inputMode="decimal"
                                    placeholder="0.00"
                                    className={`${field} w-20 text-right`}
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        setLines((ls) =>
                                            ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls,
                                        );
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
                                setLines((ls) => [...ls, blankLine()]);
                            }}
                            className="text-sm font-medium text-accent transition hover:opacity-80"
                        >
                            + Add line
                        </button>
                    </div>

                    <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                        Notes
                        <textarea
                            value={notes}
                            onChange={(e) => {
                                setNotes(e.target.value);
                            }}
                            rows={2}
                            className={field}
                        />
                    </label>
                    {error ? <p className="text-sm text-danger">{error}</p> : null}
                </div>
                <div className="flex items-center justify-between border-t border-line px-6 py-4">
                    <span className="text-sm text-muted">
                        Subtotal{" "}
                        <span className="font-semibold text-ink">{formatMoney(subtotal)}</span>
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
                            disabled={busy}
                            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                        >
                            {busy ? "Saving…" : "Save draft"}
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
    const [busy, setBusy] = useState(false);

    if (row === null) return null;
    const isInvoice = kind === "invoices";

    const act = async (fn: () => Promise<unknown>): Promise<void> => {
        setBusy(true);
        try {
            await fn();
            onClose();
        } catch {
            setBusy(false);
        }
    };

    const actions: { label: string; run: () => Promise<unknown> }[] = [];
    if (isInvoice) {
        if (row.status === "draft")
            actions.push({ label: "Send", run: () => sendInvoice(api, row.id) });
        if (row.status !== "void" && row.status !== "paid")
            actions.push({ label: "Void", run: () => voidInvoice(api, row.id) });
    } else {
        if (row.status === "draft")
            actions.push({ label: "Send", run: () => sendEstimate(api, row.id) });
        if (row.status === "sent") {
            actions.push({ label: "Accept", run: () => acceptEstimate(api, row.id) });
            actions.push({ label: "Decline", run: () => declineEstimate(api, row.id) });
        }
        if (
            (row.status === "sent" || row.status === "accepted") &&
            (row as EstimateRow).converted_invoice_id === null
        )
            actions.push({ label: "Convert to invoice", run: () => convertEstimate(api, row.id) });
    }

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
                            key={a.label}
                            type="button"
                            disabled={busy}
                            onClick={() => void act(a.run)}
                            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                        >
                            {a.label}
                        </button>
                    ))}
                </div>
            </div>
        </Overlay>
    );
}
