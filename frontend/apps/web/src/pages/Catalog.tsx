import {
    ITEM_KINDS,
    KIND_LABEL,
    createItem,
    filterItems,
    formatMoney,
    useCatalogItems,
} from "@clientbridge/app-core";
import { type FormEvent, useMemo, useState } from "react";

import { IconPlus, IconSearch } from "../components/icons";
import { api } from "../lib/api";

export function Catalog() {
    const items = useCatalogItems();
    const [q, setQ] = useState("");
    const [adding, setAdding] = useState(false);

    const filtered = useMemo(() => filterItems(items, q), [items, q]);

    return (
        <div>
            <header className="flex items-center justify-between gap-4">
                <div>
                    <h1 className="font-display text-2xl font-bold">Catalog &amp; services</h1>
                    <p className="mt-0.5 text-sm text-muted">{items.length} items</p>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        setAdding(true);
                    }}
                    className="flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90"
                >
                    <IconPlus className="h-4 w-4" /> Add item
                </button>
            </header>

            <div className="relative mt-6">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                    value={q}
                    onChange={(e) => {
                        setQ(e.target.value);
                    }}
                    placeholder="Search catalog…"
                    className="w-full rounded-md border border-line bg-surface py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-muted focus:border-accent"
                />
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-line bg-surface">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                            <th className="px-4 py-3 font-semibold">Name</th>
                            <th className="px-4 py-3 font-semibold">Type</th>
                            <th className="px-4 py-3 font-semibold">Duration</th>
                            <th className="px-4 py-3 text-right font-semibold">Price</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map((i) => (
                            <tr
                                key={i.id}
                                className={`border-b border-line-soft transition last:border-0 hover:bg-bg ${
                                    i.active ? "" : "opacity-50"
                                }`}
                            >
                                <td className="px-4 py-3">
                                    <div className="font-medium text-ink">{i.name}</div>
                                    {i.category ? (
                                        <div className="text-xs text-muted">{i.category}</div>
                                    ) : null}
                                </td>
                                <td className="px-4 py-3">
                                    <span className="rounded-full bg-accent-weak px-2 py-0.5 text-xs font-medium text-accent">
                                        {KIND_LABEL[i.kind] ?? i.kind}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-ink-soft">
                                    {i.duration_min ? `${String(i.duration_min)} min` : "—"}
                                </td>
                                <td className="px-4 py-3 text-right font-medium tabular-nums text-ink">
                                    {formatMoney(i.price_cents)}
                                </td>
                            </tr>
                        ))}
                        {filtered.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={4}
                                    className="px-4 py-12 text-center text-sm text-muted"
                                >
                                    {q ? "No items match your search." : "No catalog items yet."}
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>

            {adding ? (
                <AddItemModal
                    onClose={() => {
                        setAdding(false);
                    }}
                />
            ) : null}
        </div>
    );
}

function AddItemModal({ onClose }: { onClose: () => void }) {
    const [kind, setKind] = useState<string>("service");
    const [name, setName] = useState("");
    const [price, setPrice] = useState("");
    const [duration, setDuration] = useState("");
    const [category, setCategory] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: FormEvent): Promise<void> => {
        e.preventDefault();
        if (!name.trim()) {
            setError("Name is required");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await createItem(api, {
                kind,
                name,
                priceDollars: price,
                durationMin: duration,
                category,
            });
            onClose();
        } catch {
            setError("Could not add item");
            setBusy(false);
        }
    };

    const field =
        "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-accent";

    return (
        <div
            className="fixed inset-0 z-20 flex items-center justify-center p-4"
            style={{ backgroundColor: "rgba(20,25,30,0.35)" }}
        >
            <form
                onSubmit={(e) => void submit(e)}
                className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-card"
            >
                <h2 className="font-display text-lg font-bold text-ink">Add item</h2>
                <div className="mt-4 flex flex-col gap-3">
                    <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                        Type
                        <select
                            value={kind}
                            onChange={(e) => {
                                setKind(e.target.value);
                            }}
                            className={field}
                        >
                            {ITEM_KINDS.map((k) => (
                                <option key={k} value={k}>
                                    {KIND_LABEL[k]}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                        Name
                        <input
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value);
                            }}
                            autoFocus
                            className={field}
                        />
                    </label>
                    <div className="flex gap-3">
                        <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-ink-soft">
                            Price ($)
                            <input
                                value={price}
                                onChange={(e) => {
                                    setPrice(e.target.value);
                                }}
                                inputMode="decimal"
                                placeholder="0.00"
                                className={field}
                            />
                        </label>
                        <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-ink-soft">
                            Duration (min)
                            <input
                                value={duration}
                                onChange={(e) => {
                                    setDuration(e.target.value);
                                }}
                                inputMode="numeric"
                                placeholder="—"
                                className={field}
                            />
                        </label>
                    </div>
                    <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                        Category
                        <input
                            value={category}
                            onChange={(e) => {
                                setCategory(e.target.value);
                            }}
                            className={field}
                        />
                    </label>
                    {error ? <p className="text-sm text-danger-fg">{error}</p> : null}
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
                        disabled={busy}
                        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                    >
                        {busy ? "Adding…" : "Add item"}
                    </button>
                </div>
            </form>
        </div>
    );
}
