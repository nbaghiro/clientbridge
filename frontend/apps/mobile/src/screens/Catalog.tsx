import {
    type ItemRow,
    itemMeta,
    itemPriceLabel,
    itemStatus,
    mediaUrl,
    strings,
    useCatalogView,
    useKindPicker,
    useProductsView,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Button,
    Choice,
    Empty,
    ItemImage,
    ItemTile,
    ListRow,
    Modal,
    SearchField,
    StatusPill,
    Tabs,
} from "@clientbridge/ui";
import { useState } from "react";
import { FlatList, ScrollView, StyleSheet, Text, View } from "react-native";

import { ItemEditor } from "../components/ItemEditor";
import { Inventory, Loaded } from "../components/Stock";
import { apiBaseUrl } from "../lib/api";

const s = strings.catalog;
const c = theme.colors;

type View_ = "catalog" | "products" | "inventory";

const VIEWS: { key: View_; label: string }[] = [
    { key: "catalog", label: s.views.catalog },
    { key: "products", label: s.views.products },
    { key: "inventory", label: s.views.inventory },
];

export function CatalogScreen() {
    const [view, setView] = useState<View_>("catalog");
    return (
        <View style={styles.screen}>
            <View style={styles.tabs}>
                <Tabs
                    variant="pill"
                    items={VIEWS}
                    active={view}
                    onSelect={setView}
                    label={s.viewsLabel}
                />
            </View>
            {view === "catalog" ? <CatalogList /> : null}
            {view === "products" ? <ProductGrid /> : null}
            {view === "inventory" ? <Inventory /> : null}
        </View>
    );
}

function CatalogRow({ item }: { item: ItemRow }) {
    const status = itemStatus(item);
    return (
        <View style={[styles.row, item.active !== 1 && styles.dim]}>
            <ItemImage
                src={mediaUrl(apiBaseUrl, item.image_file_id)}
                name={item.name}
                color={item.color}
                size={40}
            />
            <View style={styles.flex}>
                <Text style={styles.name} numberOfLines={1}>
                    {item.name}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                    {itemMeta(item)}
                </Text>
            </View>
            <View style={styles.right}>
                <Text style={styles.price}>{itemPriceLabel(item)}</Text>
                {status !== null ? (
                    <StatusPill status={status.label} intent={status.intent} asWritten />
                ) : null}
            </View>
        </View>
    );
}

function KindSheet({ onClose, onPick }: { onClose: () => void; onPick: (kind: string) => void }) {
    const picker = useKindPicker();
    return (
        <Modal open onClose={onClose}>
            <Text style={styles.sheetTitle}>{s.whatAdding}</Text>
            <Text style={styles.summary}>{s.whatAddingHint}</Text>
            <View style={styles.tiles}>
                <Choice
                    layout="tiles"
                    columns={2}
                    label={s.whatAdding}
                    options={picker.options}
                    value={picker.kind}
                    onChange={picker.setKind}
                />
            </View>
            <Button
                size="lg"
                full
                disabled={picker.kind === null}
                onPress={() => {
                    if (picker.kind !== null) onPick(picker.kind);
                }}
            >
                {s.next}
            </Button>
        </Modal>
    );
}

function CatalogList() {
    const view = useCatalogView();
    const [choosing, setChoosing] = useState(false);
    const [open, setOpen] = useState<{ item: ItemRow | null; kind: string } | null>(null);
    const add = (
        <Button
            size="sm"
            onPress={() => {
                setChoosing(true);
            }}
        >
            {s.addShort}
        </Button>
    );

    return (
        <View style={styles.flexFill}>
            <View style={styles.head}>
                <Text style={[styles.summary, styles.flex]}>{view.summary ?? ""}</Text>
                {add}
            </View>
            <View style={styles.search}>
                <SearchField
                    value={view.q}
                    onChange={view.setQ}
                    placeholder={s.searchPlaceholder}
                />
            </View>
            {view.load.ready ? (
                <Tabs
                    variant="pill"
                    items={view.filters}
                    active={view.filter}
                    onSelect={view.setFilter}
                />
            ) : null}
            <ScrollView contentContainerStyle={styles.body}>
                {view.load.state === "empty" ? (
                    <Empty
                        variant="card"
                        icon="tag"
                        message={s.emptyCatalogTitle}
                        body={s.emptyCatalogBody}
                        actions={add}
                    />
                ) : (
                    <Loaded load={view.load} label={s.loadingCatalog} error={s.loadErrorCatalog}>
                        {view.sections.length === 0 ? <Empty message={view.empty} /> : null}
                        {view.sections.map((sec) => (
                            <View key={sec.key} style={styles.section}>
                                <View style={styles.secHead}>
                                    <Text style={styles.secTitle}>{sec.title}</Text>
                                    <Text style={styles.count}>{s.countIn(sec.items.length)}</Text>
                                </View>
                                <View style={styles.card}>
                                    {sec.items.map((i, n) => (
                                        <View key={i.id} style={n > 0 && styles.divider}>
                                            <ListRow
                                                title={<CatalogRow item={i} />}
                                                label={i.name}
                                                onPress={() => {
                                                    setOpen({ item: i, kind: i.kind });
                                                }}
                                            />
                                        </View>
                                    ))}
                                </View>
                            </View>
                        ))}
                    </Loaded>
                )}
            </ScrollView>
            {choosing ? (
                <KindSheet
                    onClose={() => {
                        setChoosing(false);
                    }}
                    onPick={(kind) => {
                        setChoosing(false);
                        setOpen({ item: null, kind });
                    }}
                />
            ) : null}
            {open !== null ? (
                <ItemEditor
                    key={open.item?.id ?? `new-${open.kind}`}
                    item={open.item}
                    kind={open.kind}
                    items={view.items}
                    onClose={() => {
                        setOpen(null);
                    }}
                />
            ) : null}
        </View>
    );
}

function ProductGrid() {
    const view = useProductsView();
    const [open, setOpen] = useState<{ item: ItemRow | null } | null>(null);
    const add = (
        <Button
            size="sm"
            onPress={() => {
                setOpen({ item: null });
            }}
        >
            {s.addShort}
        </Button>
    );
    return (
        <View style={styles.flexFill}>
            <View style={styles.head}>
                <Text style={[styles.summary, styles.flex]} numberOfLines={1}>
                    {view.summary ?? ""}
                </Text>
                {add}
            </View>
            <View style={styles.search}>
                <SearchField
                    value={view.q}
                    onChange={view.setQ}
                    placeholder={s.searchPlaceholder}
                />
            </View>
            <Tabs
                variant="pill"
                items={view.filters}
                active={view.filter}
                onSelect={view.setFilter}
            />
            {view.load.state === "empty" ? (
                <View style={styles.gate}>
                    <Empty
                        variant="card"
                        icon="bag"
                        message={s.emptyProductsTitle}
                        body={s.emptyProductsBody}
                        actions={add}
                    />
                </View>
            ) : view.load.ready ? (
                <FlatList
                    data={view.rows}
                    keyExtractor={(r) => r.item.id}
                    numColumns={2}
                    columnWrapperStyle={styles.gridRow}
                    contentContainerStyle={styles.grid}
                    ListEmptyComponent={<Empty message={view.empty} />}
                    renderItem={({ item: r }) => (
                        <View style={styles.flex}>
                            <ItemTile
                                variant="card"
                                name={r.item.name}
                                imageSrc={mediaUrl(apiBaseUrl, r.item.image_file_id)}
                                color={r.item.color}
                                cents={r.item.price_cents}
                                meta={r.stock?.label ?? s.untracked}
                                tag={
                                    r.stock !== null && r.stock.intent !== "success"
                                        ? { label: r.stock.label, intent: r.stock.intent }
                                        : null
                                }
                                onPress={() => {
                                    setOpen({ item: r.item });
                                }}
                            />
                        </View>
                    )}
                />
            ) : (
                <View style={styles.gate}>
                    <Loaded load={view.load} label={s.loadingProducts} error={s.loadErrorProducts}>
                        {null}
                    </Loaded>
                </View>
            )}
            {open !== null ? (
                <ItemEditor
                    key={open.item?.id ?? "new"}
                    item={open.item}
                    kind="product"
                    items={[]}
                    onClose={() => {
                        setOpen(null);
                    }}
                />
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    flexFill: { flex: 1 },
    flex: { flex: 1, minWidth: 0 },
    tabs: { paddingTop: 10 },
    head: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingTop: 10,
    },
    summary: { color: c.muted, fontSize: 13, marginTop: 2 },
    search: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
    body: { paddingHorizontal: 16, paddingBottom: 24, paddingTop: 4 },
    section: { marginTop: 16 },
    secHead: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "baseline",
        marginBottom: 6,
    },
    secTitle: { color: c.ink, fontSize: 15, fontWeight: "700" },
    count: { color: c.muted, fontSize: 12.5 },
    card: {
        borderRadius: theme.radius + 2,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        overflow: "hidden",
    },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderSoft },
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    dim: { opacity: 0.55 },
    name: { color: c.ink, fontSize: 15.5, fontWeight: "600" },
    meta: { color: c.muted, fontSize: 12.5, marginTop: 2 },
    right: { alignItems: "flex-end", gap: 4 },
    price: { color: c.ink, fontSize: 14.5, fontWeight: "700", fontVariant: ["tabular-nums"] },
    sheetTitle: { color: c.ink, fontSize: 19, fontWeight: "700" },
    tiles: { marginTop: 14, marginBottom: 16 },
    grid: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },
    gridRow: { gap: 10, marginBottom: 10 },
    gate: { paddingHorizontal: 16, paddingTop: 8 },
});
