import {
    type CatalogGroup,
    type ItemRow,
    itemMeta,
    itemPriceLabel,
    itemStatus,
    mediaUrl,
    strings,
    useCatalogView,
    useKindPicker,
    useProductsView,
    useShopLink,
    BUSINESS_CURRENCY,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Button,
    Choice,
    CopyField,
    Empty,
    ItemImage,
    ItemTile,
    ListRow,
    Modal,
    Panel,
    SearchField,
    SheetHeader,
    StatusPill,
    Select,
    Tabs,
} from "@clientbridge/ui";
import { useState } from "react";
import { FlatList, ScrollView, Share, StyleSheet, Text, View } from "react-native";

import { ItemEditor } from "../components/ItemEditor";
import { Loaded } from "../components/Loaded";
import { Inventory } from "../components/Stock";
import { apiBaseUrl } from "../lib/api";
import { shopUrl } from "../lib/config";

const s = strings.catalog;
const c = theme.colors;

type View_ = CatalogGroup | "products" | "inventory";

const VIEWS: { key: View_; label: string }[] = [
    {
        key: "services",
        get label() {
            return s.views.services;
        },
    },
    {
        key: "plans",
        get label() {
            return s.views.plans;
        },
    },
    {
        key: "products",
        get label() {
            return s.views.products;
        },
    },
    {
        key: "inventory",
        get label() {
            return s.views.inventory;
        },
    },
];

export function CatalogScreen() {
    const [view, setView] = useState<View_>("services");
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
            {view === "services" || view === "plans" ? (
                <CatalogList key={view} group={view} />
            ) : null}
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
                    <StatusPill status={status.label} intent={status.intent} />
                ) : null}
            </View>
        </View>
    );
}

function KindSheet({
    kinds,
    onClose,
    onPick,
}: {
    kinds: readonly string[];
    onClose: () => void;
    onPick: (kind: string) => void;
}) {
    const picker = useKindPicker(kinds);
    return (
        <Modal open onClose={onClose}>
            <SheetHeader title={s.whatAdding} onClose={onClose} />
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

function CatalogList({ group }: { group: CatalogGroup }) {
    const view = useCatalogView(group);
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
            <View style={[styles.search, styles.filterRow]}>
                <SearchField
                    style={styles.flex}
                    value={view.q}
                    onChange={view.setQ}
                    placeholder={s.searchPlaceholder}
                />
                <Select
                    name={s.filterLabel}
                    size="sm"
                    width="auto"
                    options={view.statuses}
                    value={view.status}
                    onChange={view.setStatus}
                />
            </View>
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
                    <Loaded
                        load={view.load}
                        loading={s.loadingCatalog}
                        failed={s.loadErrorCatalog}
                        rows={5}
                    >
                        {view.sections.length === 0 ? <Empty message={view.empty} /> : null}
                        {view.sections.map((sec) => (
                            <View key={sec.key} style={styles.section}>
                                <View style={styles.secHead}>
                                    <Text style={styles.secTitle}>{sec.title}</Text>
                                    <Text style={styles.count}>{s.countIn(sec.items.length)}</Text>
                                </View>
                                <Panel flush>
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
                                </Panel>
                            </View>
                        ))}
                    </Loaded>
                )}
            </ScrollView>
            {choosing ? (
                <KindSheet
                    kinds={view.kinds}
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
    const shop = useShopLink(shopUrl);
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
            {shop !== null ? (
                <View style={styles.search}>
                    <CopyField
                        label={s.shopLinkTitle}
                        value={shop.linkLabel}
                        hint={shop.live ? s.shopLinkHint : s.shopLinkNotLive}
                        copied={false}
                        copyLabel={s.shopLinkShare}
                        onCopy={() => {
                            Share.share({ message: shop.link }).catch(() => undefined);
                        }}
                    />
                </View>
            ) : null}
            <View style={[styles.search, styles.filterRow]}>
                <SearchField
                    style={styles.flex}
                    value={view.q}
                    onChange={view.setQ}
                    placeholder={s.searchPlaceholder}
                />
                <Select
                    name={s.filterLabel}
                    size="sm"
                    width="auto"
                    options={view.filters}
                    value={view.filter}
                    onChange={view.setFilter}
                />
            </View>
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
                                currency={BUSINESS_CURRENCY}
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
                    <Loaded
                        load={view.load}
                        loading={s.loadingProducts}
                        failed={s.loadErrorProducts}
                        rows={5}
                    >
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
    screen: { flex: 1 },
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
    summary: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 13, marginTop: 2 },
    search: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
    filterRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    body: { paddingHorizontal: 16, paddingBottom: 24, paddingTop: 4 },
    section: { marginTop: 16 },
    secHead: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "baseline",
        marginBottom: 6,
    },
    secTitle: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: theme.type.section,
        fontWeight: "700",
    },
    count: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 12.5 },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderSoft },
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    dim: { opacity: 0.55 },
    name: { color: c.ink, fontFamily: theme.fonts.ui, fontSize: 15.5, fontWeight: "600" },
    meta: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 12.5, marginTop: 2 },
    right: { alignItems: "flex-end", gap: 4 },
    price: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: 14.5,
        fontWeight: "700",
        fontVariant: ["tabular-nums"],
    },
    tiles: { marginTop: 14, marginBottom: 16 },
    grid: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },
    gridRow: { gap: 10, marginBottom: 10 },
    gate: { paddingHorizontal: 16, paddingTop: 8 },
});
