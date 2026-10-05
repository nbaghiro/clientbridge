import {
    CATALOG_FILTERS,
    catalogEmptyText,
    type CatalogFilter,
    DEPOSIT_TYPES,
    FREQUENCIES,
    ITEM_KINDS,
    type ItemForm,
    type ItemRow,
    KIND_LABEL,
    TAX_CLASSES,
    canManageCatalog,
    filterCatalog,
    filterItems,
    itemImageTarget,
    mediaUrl,
    stockIntent,
    stockLabel,
    stockState,
    strings,
    useCatalogItems,
    useItemForm,
    useRestockForm,
    useSearch,
} from "@clientbridge/app-core";
import {
    DetailSection,
    DetailView,
    ItemImage,
    ListPage,
    Money,
    StatusPill,
} from "@clientbridge/ui";
import { type ReactNode, useMemo, useState } from "react";

import { ItemImageUpload } from "../components/ItemImageUpload";
import { api, apiBaseUrl } from "../lib/api";
import { useRole } from "../lib/auth";

const GRID = "grid grid-cols-[2fr_1fr_1fr_1fr] items-center gap-4";
const field =
    "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-hidden placeholder:text-muted focus:border-accent";
const primary =
    "rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60";
const quiet =
    "rounded-md border border-line px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-bg disabled:opacity-60";

export function Catalog() {
    const items = useCatalogItems();
    const [filter, setFilter] = useState<CatalogFilter>("all");
    const shown = useMemo(() => filterCatalog(items, filter), [items, filter]);
    const { q, setQ, filtered } = useSearch(shown, filterItems);
    const [open, setOpen] = useState<ItemRow | "new" | null>(null);
    const editable = canManageCatalog(useRole());
    const current = open === "new" || open === null ? open : items.find((i) => i.id === open.id);

    return (
        <div>
            <ListPage
                summary={strings.catalog.itemCount(items.length)}
                action={
                    editable
                        ? {
                              label: strings.catalog.addItem,
                              onPress: () => {
                                  setOpen("new");
                              },
                          }
                        : undefined
                }
                segments={{ items: CATALOG_FILTERS, active: filter, onSelect: setFilter }}
                search={{
                    value: q,
                    onChange: setQ,
                    placeholder: strings.catalog.searchPlaceholder,
                }}
                head={
                    <div className={GRID}>
                        <span>{strings.catalog.name}</span>
                        <span>{strings.catalog.type}</span>
                        <span>
                            {strings.catalog.duration} / {strings.catalog.stockHeading}
                        </span>
                        <span className="text-right">{strings.catalog.price}</span>
                    </div>
                }
                rows={filtered}
                rowKey={(i) => i.id}
                onRowPress={
                    editable
                        ? (i) => {
                              setOpen(i);
                          }
                        : undefined
                }
                empty={catalogEmptyText(q, filter)}
                renderRow={(i) => <ItemRowView item={i} />}
            />

            {current !== undefined && current !== null ? (
                <ItemDetail
                    key={current === "new" ? "new" : current.id}
                    item={current === "new" ? null : current}
                    onClose={() => {
                        setOpen(null);
                    }}
                />
            ) : null}
        </div>
    );
}

function ItemRowView({ item }: { item: ItemRow }) {
    const state = stockState(item);
    return (
        <div className={`${GRID} ${item.active === 1 ? "" : "opacity-50"}`}>
            <div className="flex items-center gap-3">
                <ItemImage
                    src={mediaUrl(apiBaseUrl, item.image_file_id)}
                    name={item.name}
                    color={item.color}
                />
                <div className="min-w-0">
                    <div className="truncate font-medium text-ink">{item.name}</div>
                    <div className="truncate text-xs text-muted">
                        {[item.category, item.sku].filter(Boolean).join(" · ")}
                    </div>
                </div>
            </div>
            <span>
                <span className="rounded-full bg-accent-weak px-2 py-0.5 text-xs font-medium text-accent">
                    {KIND_LABEL[item.kind] ?? item.kind}
                </span>
            </span>
            <span className="text-ink-soft">
                {state !== "untracked" ? (
                    <StatusPill status={stockLabel(item)} intent={stockIntent(state)} asWritten />
                ) : item.duration_min ? (
                    strings.catalog.durationMin(item.duration_min)
                ) : (
                    strings.clients.dash
                )}
            </span>
            <span className="text-right">
                <Money cents={item.price_cents} />
            </span>
        </div>
    );
}

function ItemDetail({ item, onClose }: { item: ItemRow | null; onClose: () => void }) {
    const form = useItemForm(api, item, onClose);
    const archived = item !== null && item.active !== 1;

    return (
        <DetailView
            open
            title={item?.name ?? strings.catalog.newItem}
            subtitle={item === null ? undefined : (KIND_LABEL[item.kind] ?? item.kind)}
            status={
                archived ? { status: strings.catalog.archivedPill, intent: "neutral" } : undefined
            }
            onClose={onClose}
            actions={
                <>
                    {item !== null ? (
                        <button
                            type="button"
                            onClick={archived ? form.restore : form.archive}
                            disabled={form.busy}
                            className={quiet}
                        >
                            {archived ? strings.catalog.restore : strings.catalog.archive}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={form.submit}
                        disabled={form.busy}
                        className={primary}
                    >
                        {form.busy
                            ? strings.catalog.saving
                            : item === null
                              ? strings.catalog.addItem
                              : strings.catalog.save}
                    </button>
                </>
            }
        >
            {item !== null ? (
                <DetailSection>
                    <div className="flex items-center gap-3">
                        <ItemImageUpload
                            src={mediaUrl(apiBaseUrl, item.image_file_id)}
                            name={item.name}
                            color={item.color}
                            size={56}
                            target={itemImageTarget(item.id)}
                        />
                        <span className="text-sm text-muted">{strings.files.changeImage}</span>
                    </div>
                </DetailSection>
            ) : null}
            <DetailSection>
                <ItemFields form={form} />
                {form.error !== null ? (
                    <p className="mt-3 text-sm text-danger-fg">{form.error}</p>
                ) : null}
            </DetailSection>
            {item !== null && item.track_stock === 1 ? <RestockSection item={item} /> : null}
        </DetailView>
    );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
    return (
        <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-ink-soft">
            {label}
            {children}
            {hint !== undefined ? (
                <span className="text-xs font-normal text-muted">{hint}</span>
            ) : null}
        </label>
    );
}

function TextField({
    form,
    name,
    label,
    hint,
    numeric,
}: {
    form: ItemForm;
    name:
        | "name"
        | "category"
        | "price"
        | "duration"
        | "bufferBefore"
        | "bufferAfter"
        | "capacity"
        | "depositValue"
        | "sessionCount"
        | "validityDays"
        | "interval"
        | "sku"
        | "cost"
        | "openingStock"
        | "lowStockAt";
    label: string;
    hint?: string;
    numeric?: "decimal" | "numeric";
}) {
    return (
        <Field label={label} {...(hint !== undefined ? { hint } : {})}>
            <input
                value={form.values[name]}
                onChange={(e) => {
                    form.set(name, e.target.value);
                }}
                {...(numeric !== undefined ? { inputMode: numeric } : {})}
                className={field}
            />
        </Field>
    );
}

function Select({
    value,
    options,
    onChange,
}: {
    value: string;
    options: { value: string; label: string }[];
    onChange: (v: string) => void;
}) {
    return (
        <select
            value={value}
            onChange={(e) => {
                onChange(e.target.value);
            }}
            className={field}
        >
            {options.map((o) => (
                <option key={o.value} value={o.value}>
                    {o.label}
                </option>
            ))}
        </select>
    );
}

function Check({
    checked,
    label,
    onChange,
}: {
    checked: boolean;
    label: string;
    onChange: (v: boolean) => void;
}) {
    return (
        <label className="flex items-center gap-2 text-sm text-ink">
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                    onChange(e.target.checked);
                }}
                className="h-4 w-4 accent-accent"
            />
            {label}
        </label>
    );
}

function ItemFields({ form }: { form: ItemForm }) {
    const v = form.values;
    return (
        <div className="flex flex-col gap-3">
            {form.editing ? null : (
                <Field label={strings.catalog.type}>
                    <Select
                        value={v.kind}
                        options={ITEM_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] ?? k }))}
                        onChange={(k) => {
                            form.set("kind", k);
                        }}
                    />
                </Field>
            )}
            <TextField form={form} name="name" label={strings.catalog.name} />
            <Field label={strings.catalog.description}>
                <textarea
                    value={v.description}
                    onChange={(e) => {
                        form.set("description", e.target.value);
                    }}
                    rows={2}
                    className={field}
                />
            </Field>
            <div className="flex gap-3">
                <TextField
                    form={form}
                    name="price"
                    label={strings.catalog.priceLabel}
                    numeric="decimal"
                />
                <TextField form={form} name="category" label={strings.catalog.category} />
            </div>

            {form.shows("duration") ? (
                <div className="flex gap-3">
                    <TextField
                        form={form}
                        name="duration"
                        label={strings.catalog.durationLabel}
                        numeric="numeric"
                    />
                    <TextField
                        form={form}
                        name="bufferBefore"
                        label={strings.catalog.bufferBefore}
                        numeric="numeric"
                    />
                    <TextField
                        form={form}
                        name="bufferAfter"
                        label={strings.catalog.bufferAfter}
                        numeric="numeric"
                    />
                </div>
            ) : null}
            {form.shows("capacity") ? (
                <TextField
                    form={form}
                    name="capacity"
                    label={strings.catalog.capacity}
                    numeric="numeric"
                />
            ) : null}
            {form.shows("onlineBookable") ? (
                <Check
                    checked={v.onlineBookable}
                    label={strings.catalog.onlineBookable}
                    onChange={(c) => {
                        form.set("onlineBookable", c);
                    }}
                />
            ) : null}
            {form.shows("depositType") ? (
                <div className="flex gap-3">
                    <Field label={strings.catalog.depositType}>
                        <Select
                            value={v.depositType}
                            options={DEPOSIT_TYPES}
                            onChange={(t) => {
                                form.set("depositType", t);
                            }}
                        />
                    </Field>
                    {v.depositType !== "none" ? (
                        <TextField
                            form={form}
                            name="depositValue"
                            label={
                                v.depositType === "fixed"
                                    ? strings.catalog.depositAmount
                                    : strings.catalog.depositPercentLabel
                            }
                            numeric="decimal"
                        />
                    ) : null}
                </div>
            ) : null}

            {form.shows("sessionCount") ? (
                <div className="flex gap-3">
                    <TextField
                        form={form}
                        name="sessionCount"
                        label={strings.catalog.sessionCount}
                        numeric="numeric"
                    />
                    <TextField
                        form={form}
                        name="validityDays"
                        label={strings.catalog.validityDays}
                        hint={strings.catalog.validityHint}
                        numeric="numeric"
                    />
                </div>
            ) : null}

            {form.shows("interval") ? (
                <div className="flex gap-3">
                    <TextField
                        form={form}
                        name="interval"
                        label={strings.catalog.intervalLabel}
                        numeric="numeric"
                    />
                    <Field label={strings.catalog.repeatsEvery}>
                        <Select
                            value={v.frequency}
                            options={FREQUENCIES}
                            onChange={(f) => {
                                form.set("frequency", f);
                            }}
                        />
                    </Field>
                </div>
            ) : null}

            {form.shows("sku") ? (
                <div className="flex gap-3">
                    <TextField form={form} name="sku" label={strings.catalog.sku} />
                    <TextField
                        form={form}
                        name="cost"
                        label={strings.catalog.cost}
                        numeric="decimal"
                    />
                </div>
            ) : null}
            {form.shows("trackStock") ? (
                <>
                    <Check
                        checked={v.trackStock}
                        label={strings.catalog.trackStock}
                        onChange={(c) => {
                            form.set("trackStock", c);
                        }}
                    />
                    {v.trackStock ? (
                        <div className="flex gap-3">
                            {form.editing ? null : (
                                <TextField
                                    form={form}
                                    name="openingStock"
                                    label={strings.catalog.openingStock}
                                    numeric="numeric"
                                />
                            )}
                            <TextField
                                form={form}
                                name="lowStockAt"
                                label={strings.catalog.lowStockAt}
                                numeric="numeric"
                            />
                        </div>
                    ) : null}
                </>
            ) : null}
            {form.shows("sellOnline") ? (
                <Check
                    checked={v.sellOnline}
                    label={strings.catalog.sellOnline}
                    onChange={(c) => {
                        form.set("sellOnline", c);
                    }}
                />
            ) : null}

            <Field label={strings.catalog.taxClass} hint={strings.catalog.taxNote}>
                <Select
                    value={v.taxClass}
                    options={TAX_CLASSES}
                    onChange={(t) => {
                        form.set("taxClass", t);
                    }}
                />
            </Field>
        </div>
    );
}

function RestockSection({ item }: { item: ItemRow }) {
    const form = useRestockForm(api, item, () => undefined);
    const state = stockState(item);
    return (
        <DetailSection
            title={strings.catalog.stockHeading}
            action={<StatusPill status={stockLabel(item)} intent={stockIntent(state)} asWritten />}
        >
            <div className="flex items-end gap-3">
                <Field label={strings.catalog.restockQuantity}>
                    <input
                        value={form.quantity}
                        onChange={(e) => {
                            form.setQuantity(e.target.value);
                        }}
                        inputMode="numeric"
                        className={field}
                    />
                </Field>
                <Field label={strings.catalog.restockNote}>
                    <input
                        value={form.note}
                        onChange={(e) => {
                            form.setNote(e.target.value);
                        }}
                        className={field}
                    />
                </Field>
                <button type="button" onClick={form.submit} disabled={form.busy} className={quiet}>
                    {form.busy ? strings.catalog.restocking : strings.catalog.restock}
                </button>
            </div>
            <p className="mt-1 text-xs text-muted">{strings.catalog.restockQuantityHint}</p>
            {form.error !== null ? (
                <p className="mt-2 text-sm text-danger-fg">{form.error}</p>
            ) : null}
        </DetailSection>
    );
}
