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
    Badge,
    Button,
    DetailSection,
    DetailView,
    ItemImage,
    ListPage,
    Money,
    Notice,
    Select,
    StatusPill,
    TextField,
    Toggle,
} from "@clientbridge/ui";
import { useMemo, useState } from "react";

import { ItemImageUpload } from "../components/ItemImageUpload";
import { api, apiBaseUrl } from "../lib/api";
import { useRole } from "../lib/auth";

const GRID = "grid grid-cols-[2fr_1fr_1fr_1fr] items-center gap-4";

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
                <Badge label={KIND_LABEL[item.kind] ?? item.kind} />
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
                        <Button
                            variant="outline"
                            onPress={archived ? form.restore : form.archive}
                            disabled={form.busy}
                        >
                            {archived ? strings.catalog.restore : strings.catalog.archive}
                        </Button>
                    ) : null}
                    <Button onPress={form.submit} busy={form.busy}>
                        {form.busy
                            ? strings.catalog.saving
                            : item === null
                              ? strings.catalog.addItem
                              : strings.catalog.save}
                    </Button>
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
                    <div className="mt-3">
                        <Notice tone="danger">{form.error}</Notice>
                    </div>
                ) : null}
            </DetailSection>
            {item !== null && item.track_stock === 1 ? <RestockSection item={item} /> : null}
        </DetailView>
    );
}

function ItemText({
    form,
    name,
    label,
    hint,
    numeric = false,
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
    numeric?: boolean;
}) {
    return (
        <div className="flex-1">
            <TextField
                label={label}
                hint={hint}
                type={numeric ? "number" : "text"}
                value={form.values[name]}
                onChange={(v) => {
                    form.set(name, v);
                }}
            />
        </div>
    );
}

function options(list: readonly { value: string; label: string }[]) {
    return list.map((o) => ({ key: o.value, label: o.label }));
}

function ItemFields({ form }: { form: ItemForm }) {
    const v = form.values;
    return (
        <div className="flex flex-col gap-3">
            {form.editing ? null : (
                <Select
                    label={strings.catalog.type}
                    value={v.kind}
                    options={ITEM_KINDS.map((k) => ({ key: k, label: KIND_LABEL[k] ?? k }))}
                    onChange={(k) => {
                        form.set("kind", k);
                    }}
                />
            )}
            <ItemText form={form} name="name" label={strings.catalog.name} />
            <TextField
                label={strings.catalog.description}
                multiline
                rows={2}
                value={v.description}
                onChange={(d) => {
                    form.set("description", d);
                }}
            />
            <div className="flex gap-3">
                <ItemText form={form} name="price" label={strings.catalog.priceLabel} numeric />
                <ItemText form={form} name="category" label={strings.catalog.category} />
            </div>

            {form.shows("duration") ? (
                <div className="flex gap-3">
                    <ItemText
                        form={form}
                        name="duration"
                        label={strings.catalog.durationLabel}
                        numeric
                    />
                    <ItemText
                        form={form}
                        name="bufferBefore"
                        label={strings.catalog.bufferBefore}
                        numeric
                    />
                    <ItemText
                        form={form}
                        name="bufferAfter"
                        label={strings.catalog.bufferAfter}
                        numeric
                    />
                </div>
            ) : null}
            {form.shows("capacity") ? (
                <ItemText form={form} name="capacity" label={strings.catalog.capacity} numeric />
            ) : null}
            {form.shows("onlineBookable") ? (
                <Toggle
                    value={v.onlineBookable}
                    label={strings.catalog.onlineBookable}
                    onChange={(c) => {
                        form.set("onlineBookable", c);
                    }}
                />
            ) : null}
            {form.shows("depositType") ? (
                <div className="flex gap-3">
                    <div className="flex-1">
                        <Select
                            label={strings.catalog.depositType}
                            value={v.depositType}
                            options={options(DEPOSIT_TYPES)}
                            onChange={(t) => {
                                form.set("depositType", t);
                            }}
                        />
                    </div>
                    {v.depositType !== "none" ? (
                        <ItemText
                            form={form}
                            name="depositValue"
                            label={
                                v.depositType === "fixed"
                                    ? strings.catalog.depositAmount
                                    : strings.catalog.depositPercentLabel
                            }
                            numeric
                        />
                    ) : null}
                </div>
            ) : null}

            {form.shows("sessionCount") ? (
                <div className="flex gap-3">
                    <ItemText
                        form={form}
                        name="sessionCount"
                        label={strings.catalog.sessionCount}
                        numeric
                    />
                    <ItemText
                        form={form}
                        name="validityDays"
                        label={strings.catalog.validityDays}
                        hint={strings.catalog.validityHint}
                        numeric
                    />
                </div>
            ) : null}

            {form.shows("interval") ? (
                <div className="flex gap-3">
                    <ItemText
                        form={form}
                        name="interval"
                        label={strings.catalog.intervalLabel}
                        numeric
                    />
                    <div className="flex-1">
                        <Select
                            label={strings.catalog.repeatsEvery}
                            value={v.frequency}
                            options={options(FREQUENCIES)}
                            onChange={(f) => {
                                form.set("frequency", f);
                            }}
                        />
                    </div>
                </div>
            ) : null}

            {form.shows("sku") ? (
                <div className="flex gap-3">
                    <ItemText form={form} name="sku" label={strings.catalog.sku} />
                    <ItemText form={form} name="cost" label={strings.catalog.cost} numeric />
                </div>
            ) : null}
            {form.shows("trackStock") ? (
                <>
                    <Toggle
                        value={v.trackStock}
                        label={strings.catalog.trackStock}
                        onChange={(c) => {
                            form.set("trackStock", c);
                        }}
                    />
                    {v.trackStock ? (
                        <div className="flex gap-3">
                            {form.editing ? null : (
                                <ItemText
                                    form={form}
                                    name="openingStock"
                                    label={strings.catalog.openingStock}
                                    numeric
                                />
                            )}
                            <ItemText
                                form={form}
                                name="lowStockAt"
                                label={strings.catalog.lowStockAt}
                                numeric
                            />
                        </div>
                    ) : null}
                </>
            ) : null}
            {form.shows("sellOnline") ? (
                <Toggle
                    value={v.sellOnline}
                    label={strings.catalog.sellOnline}
                    onChange={(c) => {
                        form.set("sellOnline", c);
                    }}
                />
            ) : null}

            <Select
                label={strings.catalog.taxClass}
                hint={strings.catalog.taxNote}
                value={v.taxClass}
                options={options(TAX_CLASSES)}
                onChange={(t) => {
                    form.set("taxClass", t);
                }}
            />
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
                <div className="flex-1">
                    <TextField
                        label={strings.catalog.restockQuantity}
                        type="number"
                        value={form.quantity}
                        onChange={form.setQuantity}
                    />
                </div>
                <div className="flex-1">
                    <TextField
                        label={strings.catalog.restockNote}
                        value={form.note}
                        onChange={form.setNote}
                    />
                </div>
                <Button variant="outline" onPress={form.submit} busy={form.busy}>
                    {form.busy ? strings.catalog.restocking : strings.catalog.restock}
                </Button>
            </div>
            <p className="mt-1 text-xs text-muted">{strings.catalog.restockQuantityHint}</p>
            {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
        </DetailSection>
    );
}
