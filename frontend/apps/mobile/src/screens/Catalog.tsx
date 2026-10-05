import {
    CATALOG_FILTERS,
    catalogEmptyText,
    type CatalogFilter,
    DEPOSIT_TYPES,
    FREQUENCIES,
    ITEM_KINDS,
    type ItemField,
    type ItemForm,
    type ItemRow,
    KIND_LABEL,
    TAX_CLASSES,
    canManageCatalog,
    filterCatalog,
    filterItems,
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
import { theme } from "@clientbridge/tokens/theme";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
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

import { api, apiBaseUrl } from "../lib/api";
import { useRole } from "../lib/auth";

const c = theme.colors;

export function CatalogScreen() {
    const items = useCatalogItems();
    const [filter, setFilter] = useState<CatalogFilter>("all");
    const shown = useMemo(() => filterCatalog(items, filter), [items, filter]);
    const { q, setQ, filtered } = useSearch(shown, filterItems);
    const [open, setOpen] = useState<string | null>(null);
    const editable = canManageCatalog(useRole());
    const current = open === "new" ? "new" : items.find((i) => i.id === open);

    return (
        <View style={styles.screen}>
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
                rows={filtered}
                rowKey={(i) => i.id}
                onRowPress={
                    editable
                        ? (i) => {
                              setOpen(i.id);
                          }
                        : undefined
                }
                empty={catalogEmptyText(q, filter)}
                renderRow={(item) => <ItemRowView item={item} />}
            />

            {current !== undefined ? (
                <ItemDetail
                    key={current === "new" ? "new" : current.id}
                    item={current === "new" ? null : current}
                    onClose={() => {
                        setOpen(null);
                    }}
                />
            ) : null}
        </View>
    );
}

function ItemRowView({ item }: { item: ItemRow }) {
    const state = stockState(item);
    const sub = [KIND_LABEL[item.kind] ?? item.kind, item.sku].filter(Boolean).join(" · ");
    return (
        <View style={[styles.row, item.active === 1 ? null : styles.dim]}>
            <ItemImage
                src={mediaUrl(apiBaseUrl, item.image_file_id)}
                name={item.name}
                color={item.color}
            />
            <View style={styles.rowMain}>
                <Text style={styles.rowName} numberOfLines={1}>
                    {item.name}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                    {sub}
                    {item.duration_min ? strings.catalog.durationSep(item.duration_min) : ""}
                </Text>
                {state !== "untracked" ? (
                    <View style={styles.pill}>
                        <StatusPill
                            status={stockLabel(item)}
                            intent={stockIntent(state)}
                            asWritten
                        />
                    </View>
                ) : null}
            </View>
            <Money cents={item.price_cents} strong />
        </View>
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
                        {item === null ? strings.catalog.addItem : strings.catalog.save}
                    </Button>
                </>
            }
        >
            <DetailSection>
                <ItemFields form={form} />
                {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
            </DetailSection>
            {item !== null && item.track_stock === 1 ? <RestockSection item={item} /> : null}
        </DetailView>
    );
}

type TextName = Exclude<
    ItemField,
    | "kind"
    | "onlineBookable"
    | "trackStock"
    | "sellOnline"
    | "depositType"
    | "frequency"
    | "taxClass"
>;

function Input({
    form,
    name,
    label,
    numeric = false,
    multiline = false,
}: {
    form: ItemForm;
    name: TextName;
    label: string;
    numeric?: boolean;
    multiline?: boolean;
}) {
    return (
        <View style={styles.field}>
            <TextField
                label={label}
                type={numeric ? "number" : "text"}
                multiline={multiline}
                rows={2}
                value={form.values[name]}
                onChange={(v) => {
                    form.set(name, v);
                }}
            />
        </View>
    );
}

function options(list: readonly { value: string; label: string }[]) {
    return list.map((o) => ({ key: o.value, label: o.label }));
}

function ItemFields({ form }: { form: ItemForm }) {
    const v = form.values;
    return (
        <View>
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
            <Input form={form} name="name" label={strings.catalog.name} />
            <Input form={form} name="description" label={strings.catalog.description} multiline />
            <View style={styles.twoCol}>
                <Input form={form} name="price" label={strings.catalog.priceLabel} numeric />
                <Input form={form} name="category" label={strings.catalog.category} />
            </View>

            {form.shows("duration") ? (
                <>
                    <Input
                        form={form}
                        name="duration"
                        label={strings.catalog.durationLabel}
                        numeric
                    />
                    <View style={styles.twoCol}>
                        <Input
                            form={form}
                            name="bufferBefore"
                            label={strings.catalog.bufferBefore}
                            numeric
                        />
                        <Input
                            form={form}
                            name="bufferAfter"
                            label={strings.catalog.bufferAfter}
                            numeric
                        />
                    </View>
                </>
            ) : null}
            {form.shows("capacity") ? (
                <Input form={form} name="capacity" label={strings.catalog.capacity} numeric />
            ) : null}
            {form.shows("onlineBookable") ? (
                <Toggle
                    value={v.onlineBookable}
                    label={strings.catalog.onlineBookable}
                    onChange={(b) => {
                        form.set("onlineBookable", b);
                    }}
                />
            ) : null}
            {form.shows("depositType") ? (
                <>
                    <Select
                        label={strings.catalog.depositType}
                        value={v.depositType}
                        options={options(DEPOSIT_TYPES)}
                        onChange={(t) => {
                            form.set("depositType", t);
                        }}
                    />
                    {v.depositType !== "none" ? (
                        <Input
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
                </>
            ) : null}

            {form.shows("sessionCount") ? (
                <View style={styles.twoCol}>
                    <Input
                        form={form}
                        name="sessionCount"
                        label={strings.catalog.sessionCount}
                        numeric
                    />
                    <Input
                        form={form}
                        name="validityDays"
                        label={strings.catalog.validityDays}
                        numeric
                    />
                </View>
            ) : null}

            {form.shows("interval") ? (
                <>
                    <Input
                        form={form}
                        name="interval"
                        label={strings.catalog.intervalLabel}
                        numeric
                    />
                    <Select
                        label={strings.catalog.repeatsEvery}
                        value={v.frequency}
                        options={options(FREQUENCIES)}
                        onChange={(f) => {
                            form.set("frequency", f);
                        }}
                    />
                </>
            ) : null}

            {form.shows("sku") ? (
                <View style={styles.twoCol}>
                    <Input form={form} name="sku" label={strings.catalog.sku} />
                    <Input form={form} name="cost" label={strings.catalog.cost} numeric />
                </View>
            ) : null}
            {form.shows("trackStock") ? (
                <>
                    <Toggle
                        value={v.trackStock}
                        label={strings.catalog.trackStock}
                        onChange={(b) => {
                            form.set("trackStock", b);
                        }}
                    />
                    {v.trackStock ? (
                        <View style={styles.twoCol}>
                            {form.editing ? null : (
                                <Input
                                    form={form}
                                    name="openingStock"
                                    label={strings.catalog.openingStock}
                                    numeric
                                />
                            )}
                            <Input
                                form={form}
                                name="lowStockAt"
                                label={strings.catalog.lowStockAt}
                                numeric
                            />
                        </View>
                    ) : null}
                </>
            ) : null}
            {form.shows("sellOnline") ? (
                <Toggle
                    value={v.sellOnline}
                    label={strings.catalog.sellOnline}
                    onChange={(b) => {
                        form.set("sellOnline", b);
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
        </View>
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
            <View style={styles.twoCol}>
                <View style={styles.field}>
                    <TextField
                        label={strings.catalog.restockQuantity}
                        type="number"
                        value={form.quantity}
                        onChange={form.setQuantity}
                    />
                </View>
                <View style={styles.field}>
                    <TextField
                        label={strings.catalog.restockNote}
                        value={form.note}
                        onChange={form.setNote}
                    />
                </View>
            </View>
            <Text style={styles.note}>{strings.catalog.restockQuantityHint}</Text>
            {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
            <View style={styles.restock}>
                <Button variant="outline" onPress={form.submit} busy={form.busy}>
                    {form.busy ? strings.catalog.restocking : strings.catalog.restock}
                </Button>
            </View>
        </DetailSection>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    dim: { opacity: 0.5 },
    rowMain: { flex: 1 },
    rowName: { color: c.ink, fontSize: 15, fontWeight: "600" },
    rowSub: { color: c.muted, fontSize: 13, marginTop: 1 },
    pill: { flexDirection: "row", marginTop: 4 },
    field: { flex: 1 },
    twoCol: { flexDirection: "row", gap: 10 },
    note: { color: c.muted, fontSize: 12, marginTop: 6, lineHeight: 17 },
    restock: { marginTop: 10 },
});
