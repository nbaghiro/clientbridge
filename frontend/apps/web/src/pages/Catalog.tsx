import {
    ITEM_KINDS,
    KIND_LABEL,
    canManageCatalog,
    filterItems,
    itemImageTarget,
    mediaUrl,
    formatMoney,
    strings,
    useCatalogItems,
    useItemForm,
    useSearch,
} from "@clientbridge/app-core";
import { type SubmitEvent, useState } from "react";

import { ItemImage } from "@clientbridge/ui";

import { ItemImageUpload } from "../components/ItemImageUpload";
import { IconPlus, IconSearch } from "../components/icons";
import { api, apiBaseUrl } from "../lib/api";
import { useRole } from "../lib/auth";

export function Catalog() {
    const items = useCatalogItems();
    const { q, setQ, filtered } = useSearch(items, filterItems);
    const [adding, setAdding] = useState(false);
    const editable = canManageCatalog(useRole());

    return (
        <div>
            <header className="flex items-center justify-between gap-4">
                <p className="text-sm text-muted">{strings.catalog.itemCount(items.length)}</p>
                <button
                    type="button"
                    onClick={() => {
                        setAdding(true);
                    }}
                    className="flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90"
                >
                    <IconPlus className="h-4 w-4" /> {strings.catalog.addItem}
                </button>
            </header>

            <div className="relative mt-6">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                    value={q}
                    onChange={(e) => {
                        setQ(e.target.value);
                    }}
                    placeholder={strings.catalog.searchPlaceholder}
                    className="w-full rounded-md border border-line bg-surface py-2.5 pl-9 pr-3 text-sm outline-hidden placeholder:text-muted focus:border-accent"
                />
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-line bg-surface">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                            <th className="px-4 py-3 font-semibold">{strings.catalog.name}</th>
                            <th className="px-4 py-3 font-semibold">{strings.catalog.type}</th>
                            <th className="px-4 py-3 font-semibold">{strings.catalog.duration}</th>
                            <th className="px-4 py-3 text-right font-semibold">
                                {strings.catalog.price}
                            </th>
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
                                    <div className="flex items-center gap-3">
                                        {editable ? (
                                            <ItemImageUpload
                                                src={mediaUrl(apiBaseUrl, i.image_file_id)}
                                                name={i.name}
                                                color={i.color}
                                                target={itemImageTarget(i.id)}
                                            />
                                        ) : (
                                            <ItemImage
                                                src={mediaUrl(apiBaseUrl, i.image_file_id)}
                                                name={i.name}
                                                color={i.color}
                                            />
                                        )}
                                        <div>
                                            <div className="font-medium text-ink">{i.name}</div>
                                            {i.category ? (
                                                <div className="text-xs text-muted">
                                                    {i.category}
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                </td>
                                <td className="px-4 py-3">
                                    <span className="rounded-full bg-accent-weak px-2 py-0.5 text-xs font-medium text-accent">
                                        {KIND_LABEL[i.kind] ?? i.kind}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-ink-soft">
                                    {i.duration_min
                                        ? strings.catalog.durationMin(i.duration_min)
                                        : "—"}
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
                                    {q ? strings.catalog.noMatch : strings.catalog.empty}
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
    const form = useItemForm(api, onClose);
    const submit = (e: SubmitEvent): void => {
        e.preventDefault();
        form.submit();
    };

    const field =
        "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-hidden placeholder:text-muted focus:border-accent";

    return (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-scrim p-4">
            <form
                onSubmit={submit}
                className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-card"
            >
                <h2 className="font-display text-lg font-bold text-ink">
                    {strings.catalog.addItem}
                </h2>
                <div className="mt-4 flex flex-col gap-3">
                    <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                        {strings.catalog.type}
                        <select
                            value={form.kind}
                            onChange={(e) => {
                                form.setKind(e.target.value);
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
                        {strings.catalog.name}
                        <input
                            value={form.name}
                            onChange={(e) => {
                                form.setName(e.target.value);
                            }}
                            autoFocus
                            className={field}
                        />
                    </label>
                    <div className="flex gap-3">
                        <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-ink-soft">
                            {strings.catalog.priceLabel}
                            <input
                                value={form.price}
                                onChange={(e) => {
                                    form.setPrice(e.target.value);
                                }}
                                inputMode="decimal"
                                placeholder="0.00"
                                className={field}
                            />
                        </label>
                        <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-ink-soft">
                            {strings.catalog.durationLabel}
                            <input
                                value={form.duration}
                                onChange={(e) => {
                                    form.setDuration(e.target.value);
                                }}
                                inputMode="numeric"
                                placeholder="—"
                                className={field}
                            />
                        </label>
                    </div>
                    <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                        {strings.catalog.category}
                        <input
                            value={form.category}
                            onChange={(e) => {
                                form.setCategory(e.target.value);
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
                        {strings.common.cancel}
                    </button>
                    <button
                        type="submit"
                        disabled={form.busy}
                        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                    >
                        {form.busy ? strings.catalog.adding : strings.catalog.addItem}
                    </button>
                </div>
            </form>
        </div>
    );
}
