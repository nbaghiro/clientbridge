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
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from "react-native";

import { api, apiBaseUrl } from "../lib/api";
import { useRole } from "../lib/auth";
import { DetailSection, DetailView } from "../ui/DetailView";
import { ItemImage } from "../ui/ItemImage";
import { ListPage } from "../ui/ListPage";
import { Money } from "../ui/Money";
import { StatusPill } from "../ui/StatusPill";
import { ui } from "../ui/styles";

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
                        <StatusPill status={stockLabel(item)} intent={stockIntent(state)} />
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
                        <Pressable
                            style={ui.cancel}
                            onPress={archived ? form.restore : form.archive}
                            disabled={form.busy}
                        >
                            <Text style={ui.cancelText}>
                                {archived ? strings.catalog.restore : strings.catalog.archive}
                            </Text>
                        </Pressable>
                    ) : null}
                    <Pressable style={ui.primary} onPress={form.submit} disabled={form.busy}>
                        {form.busy ? (
                            <ActivityIndicator color={c.accentInk} />
                        ) : (
                            <Text style={ui.primaryText}>
                                {item === null ? strings.catalog.addItem : strings.catalog.save}
                            </Text>
                        )}
                    </Pressable>
                </>
            }
        >
            <DetailSection>
                <ItemFields form={form} />
                {form.error !== null ? <Text style={ui.error}>{form.error}</Text> : null}
            </DetailSection>
            {item !== null && item.track_stock === 1 ? <RestockSection item={item} /> : null}
        </DetailView>
    );
}

type TextName = Exclude<
    ItemField,
    "kind" | "onlineBookable" | "trackStock" | "depositType" | "frequency" | "taxClass"
>;

function Input({
    form,
    name,
    label,
    numeric,
    multiline,
}: {
    form: ItemForm;
    name: TextName;
    label: string;
    numeric?: "decimal-pad" | "number-pad";
    multiline?: boolean;
}) {
    return (
        <View style={styles.field}>
            <Text style={ui.label}>{label}</Text>
            <TextInput
                style={[styles.input, multiline === true ? styles.multiline : null]}
                value={form.values[name]}
                onChangeText={(v) => {
                    form.set(name, v);
                }}
                {...(numeric !== undefined ? { keyboardType: numeric } : {})}
                multiline={multiline === true}
                placeholderTextColor={c.muted}
            />
        </View>
    );
}

function Chips({
    value,
    options,
    onChange,
}: {
    value: string;
    options: { value: string; label: string }[];
    onChange: (v: string) => void;
}) {
    return (
        <View style={ui.chipWrap}>
            {options.map((o) => (
                <Pressable
                    key={o.value}
                    style={[ui.chip, value === o.value ? ui.chipOn : null]}
                    onPress={() => {
                        onChange(o.value);
                    }}
                >
                    <Text style={[ui.chipText, value === o.value ? ui.chipTextOn : null]}>
                        {o.label}
                    </Text>
                </Pressable>
            ))}
        </View>
    );
}

function Toggle({
    value,
    label,
    onChange,
}: {
    value: boolean;
    label: string;
    onChange: (v: boolean) => void;
}) {
    return (
        <View style={styles.toggle}>
            <Text style={styles.toggleLabel}>{label}</Text>
            <Switch value={value} onValueChange={onChange} />
        </View>
    );
}

function ItemFields({ form }: { form: ItemForm }) {
    const v = form.values;
    return (
        <View>
            {form.editing ? null : (
                <>
                    <Text style={ui.label}>{strings.catalog.type}</Text>
                    <Chips
                        value={v.kind}
                        options={ITEM_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] ?? k }))}
                        onChange={(k) => {
                            form.set("kind", k);
                        }}
                    />
                </>
            )}
            <Input form={form} name="name" label={strings.catalog.name} />
            <Input form={form} name="description" label={strings.catalog.description} multiline />
            <View style={styles.twoCol}>
                <Input
                    form={form}
                    name="price"
                    label={strings.catalog.priceLabel}
                    numeric="decimal-pad"
                />
                <Input form={form} name="category" label={strings.catalog.category} />
            </View>

            {form.shows("duration") ? (
                <>
                    <Input
                        form={form}
                        name="duration"
                        label={strings.catalog.durationLabel}
                        numeric="number-pad"
                    />
                    <View style={styles.twoCol}>
                        <Input
                            form={form}
                            name="bufferBefore"
                            label={strings.catalog.bufferBefore}
                            numeric="number-pad"
                        />
                        <Input
                            form={form}
                            name="bufferAfter"
                            label={strings.catalog.bufferAfter}
                            numeric="number-pad"
                        />
                    </View>
                </>
            ) : null}
            {form.shows("capacity") ? (
                <Input
                    form={form}
                    name="capacity"
                    label={strings.catalog.capacity}
                    numeric="number-pad"
                />
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
                    <Text style={ui.label}>{strings.catalog.depositType}</Text>
                    <Chips
                        value={v.depositType}
                        options={DEPOSIT_TYPES}
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
                            numeric="decimal-pad"
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
                        numeric="number-pad"
                    />
                    <Input
                        form={form}
                        name="validityDays"
                        label={strings.catalog.validityDays}
                        numeric="number-pad"
                    />
                </View>
            ) : null}

            {form.shows("interval") ? (
                <>
                    <Input
                        form={form}
                        name="interval"
                        label={strings.catalog.intervalLabel}
                        numeric="number-pad"
                    />
                    <Text style={ui.label}>{strings.catalog.repeatsEvery}</Text>
                    <Chips
                        value={v.frequency}
                        options={FREQUENCIES}
                        onChange={(f) => {
                            form.set("frequency", f);
                        }}
                    />
                </>
            ) : null}

            {form.shows("sku") ? (
                <View style={styles.twoCol}>
                    <Input form={form} name="sku" label={strings.catalog.sku} />
                    <Input
                        form={form}
                        name="cost"
                        label={strings.catalog.cost}
                        numeric="decimal-pad"
                    />
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
                                    numeric="number-pad"
                                />
                            )}
                            <Input
                                form={form}
                                name="lowStockAt"
                                label={strings.catalog.lowStockAt}
                                numeric="number-pad"
                            />
                        </View>
                    ) : null}
                </>
            ) : null}

            <Text style={ui.label}>{strings.catalog.taxClass}</Text>
            <Chips
                value={v.taxClass}
                options={TAX_CLASSES}
                onChange={(t) => {
                    form.set("taxClass", t);
                }}
            />
            <Text style={ui.note}>{strings.catalog.taxNote}</Text>
        </View>
    );
}

function RestockSection({ item }: { item: ItemRow }) {
    const form = useRestockForm(api, item, () => undefined);
    const state = stockState(item);
    return (
        <DetailSection
            title={strings.catalog.stockHeading}
            action={<StatusPill status={stockLabel(item)} intent={stockIntent(state)} />}
        >
            <View style={styles.twoCol}>
                <View style={styles.field}>
                    <Text style={ui.label}>{strings.catalog.restockQuantity}</Text>
                    <TextInput
                        style={styles.input}
                        value={form.quantity}
                        onChangeText={form.setQuantity}
                        keyboardType="numbers-and-punctuation"
                    />
                </View>
                <View style={styles.field}>
                    <Text style={ui.label}>{strings.catalog.restockNote}</Text>
                    <TextInput style={styles.input} value={form.note} onChangeText={form.setNote} />
                </View>
            </View>
            <Text style={ui.note}>{strings.catalog.restockQuantityHint}</Text>
            {form.error !== null ? <Text style={ui.error}>{form.error}</Text> : null}
            <Pressable style={ui.outline} onPress={form.submit} disabled={form.busy}>
                <Text style={ui.outlineText}>
                    {form.busy ? strings.catalog.restocking : strings.catalog.restock}
                </Text>
            </Pressable>
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
    input: {
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: c.ink,
        fontSize: 15,
        backgroundColor: c.bg,
    },
    multiline: { minHeight: 64, textAlignVertical: "top" },
    twoCol: { flexDirection: "row", gap: 10 },
    toggle: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: 14,
    },
    toggleLabel: { color: c.ink, fontSize: 14, flex: 1, marginRight: 12 },
});
