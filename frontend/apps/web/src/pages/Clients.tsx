import {
    clientStatusIntent,
    filterClients,
    formatMoney,
    initials,
    useClientForm,
    useClients,
    useSearch,
} from "@clientbridge/app-core";
import { type FormEvent, useState } from "react";

import { IconPlus, IconSearch } from "../components/icons";
import { StatusPill } from "../components/StatusPill";
import { api } from "../lib/api";

export function Clients() {
    const clients = useClients();
    const { q, setQ, filtered } = useSearch(clients, filterClients);
    const [adding, setAdding] = useState(false);

    return (
        <div className="mx-auto max-w-5xl px-8 py-8">
            <header className="flex items-center justify-between gap-4">
                <div>
                    <h1 className="font-display text-2xl font-bold">Clients</h1>
                    <p className="mt-0.5 text-sm text-muted">{clients.length} total</p>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        setAdding(true);
                    }}
                    className="flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90"
                >
                    <IconPlus className="h-4 w-4" /> Add client
                </button>
            </header>

            <div className="relative mt-6">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                    value={q}
                    onChange={(e) => {
                        setQ(e.target.value);
                    }}
                    placeholder="Search clients…"
                    className="w-full rounded-md border border-line bg-surface py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-muted focus:border-accent"
                />
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-line bg-surface">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                            <th className="px-4 py-3 font-semibold">Name</th>
                            <th className="px-4 py-3 font-semibold">Phone</th>
                            <th className="px-4 py-3 font-semibold">Status</th>
                            <th className="px-4 py-3 text-right font-semibold">Lifetime</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map((c) => (
                            <tr
                                key={c.id}
                                className="border-b border-line-soft transition last:border-0 hover:bg-bg"
                            >
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-3">
                                        <span className="flex h-8 w-8 items-center justify-center rounded-avatar bg-accent-weak text-xs font-bold text-accent">
                                            {initials(c.name)}
                                        </span>
                                        <div>
                                            <div className="font-medium text-ink">{c.name}</div>
                                            {c.email ? (
                                                <div className="text-xs text-muted">{c.email}</div>
                                            ) : null}
                                        </div>
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-ink-soft">{c.phone ?? "—"}</td>
                                <td className="px-4 py-3">
                                    <StatusPill
                                        status={c.status}
                                        intent={clientStatusIntent(c.status)}
                                    />
                                </td>
                                <td className="px-4 py-3 text-right font-medium tabular-nums text-ink">
                                    {formatMoney(c.lifetime_value_cents)}
                                </td>
                            </tr>
                        ))}
                        {filtered.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={4}
                                    className="px-4 py-12 text-center text-sm text-muted"
                                >
                                    {q ? "No clients match your search." : "No clients yet."}
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>

            {adding ? (
                <AddClientModal
                    onClose={() => {
                        setAdding(false);
                    }}
                />
            ) : null}
        </div>
    );
}

function AddClientModal({ onClose }: { onClose: () => void }) {
    const form = useClientForm(api, onClose);
    const submit = (e: FormEvent): void => {
        e.preventDefault();
        form.submit();
    };

    const field =
        "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-accent";

    return (
        <div
            className="fixed inset-0 z-20 flex items-center justify-center p-4"
            style={{ backgroundColor: "rgba(20,25,30,0.35)" }}
        >
            <form
                onSubmit={submit}
                className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-card"
            >
                <h2 className="font-display text-lg font-bold text-ink">Add client</h2>
                <div className="mt-4 flex flex-col gap-3">
                    <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                        Name
                        <input
                            value={form.name}
                            onChange={(e) => {
                                form.setName(e.target.value);
                            }}
                            autoFocus
                            className={field}
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                        Email
                        <input
                            type="email"
                            value={form.email}
                            onChange={(e) => {
                                form.setEmail(e.target.value);
                            }}
                            className={field}
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                        Phone
                        <input
                            value={form.phone}
                            onChange={(e) => {
                                form.setPhone(e.target.value);
                            }}
                            className={field}
                        />
                    </label>
                    {form.error ? <p className="text-sm text-danger-fg">{form.error}</p> : null}
                </div>
                <div className="mt-5 flex justify-end gap-2">
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
                        {form.busy ? "Adding…" : "Add client"}
                    </button>
                </div>
            </form>
        </div>
    );
}
