import {
    ITEM_KINDS,
    KIND_LABEL,
    canManageCatalog,
    filterItems,
    itemImageTarget,
    mediaUrl,
    strings,
    useCatalogItems,
    useItemForm,
    useSearch,
} from "@clientbridge/app-core";
import { type SubmitEvent, useState } from "react";

import { ItemImage } from "@clientbridge/ui";

import { ItemImageUpload } from "../components/ItemImageUpload";
import { ListPage } from "../components/ListPage";
import { Money } from "../components/Money";
import { api, apiBaseUrl } from "../lib/api";
import { useRole } from "../lib/auth";

const GRID = "grid grid-cols-[2fr_1fr_1fr_1fr] items-center gap-4";

export function Catalog() {
    const items = useCatalogItems();
    const { q, setQ, filtered } = useSearch(items, filterItems);
    const [adding, setAdding] = useState(false);
    const editable = canManageCatalog(useRole());

    return (
        <div>
            <ListPage
                summary={strings.catalog.itemCount(items.length)}
                action={{
                    label: strings.catalog.addItem,
                    onPress: () => {
                        setAdding(true);
                    },
                }}
                search={{
                    value: q,
                    onChange: setQ,
                    placeholder: strings.catalog.searchPlaceholder,
                }}
                head={
                    <div className={GRID}>
                        <span>{strings.catalog.name}</span>
                        <span>{strings.catalog.type}</span>
                        <span>{strings.catalog.duration}</span>
                        <span className="text-right">{strings.catalog.price}</span>
                    </div>
                }
                rows={filtered}
                rowKey={(i) => i.id}
                empty={q ? strings.catalog.noMatch : strings.catalog.empty}
                renderRow={(i) => (
                    <div className={`${GRID} ${i.active ? "" : "opacity-50"}`}>
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
                            <div className="min-w-0">
                                <div className="truncate font-medium text-ink">{i.name}</div>
                                {i.category ? (
                                    <div className="text-xs text-muted">{i.category}</div>
                                ) : null}
                            </div>
                        </div>
                        <span>
                            <span className="rounded-full bg-accent-weak px-2 py-0.5 text-xs font-medium text-accent">
                                {KIND_LABEL[i.kind] ?? i.kind}
                            </span>
                        </span>
                        <span className="text-ink-soft">
                            {i.duration_min
                                ? strings.catalog.durationMin(i.duration_min)
                                : strings.clients.dash}
                        </span>
                        <span className="text-right">
                            <Money cents={i.price_cents} />
                        </span>
                    </div>
                )}
            />

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
