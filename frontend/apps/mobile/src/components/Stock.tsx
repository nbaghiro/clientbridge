import {
    type ItemRow,
    type Load,
    type StockRowView,
    formatMoney,
    mediaUrl,
    stockScale,
    strings,
    useInventory,
    useStockMoves,
    useReceiveDelivery,
    useRestockForm,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Badge,
    ActivityTimeline,
    Panel,
    Button,
    Empty,
    IconButton,
    ItemImage,
    ListRow,
    LoadFailed,
    Meter,
    Modal,
    Notice,
    SearchField,
    Skeleton,
    Stepper,
    TextField,
} from "@clientbridge/ui";
import { type ReactNode, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { api, apiBaseUrl } from "../lib/api";

const s = strings.catalog;
const c = theme.colors;

/** Loading draws placeholder rows, a failed load the shared retry card, anything else the content. */
export function Loaded({
    load,
    label,
    error,
    children,
}: {
    load: Load;
    label: string;
    error: string;
    children: ReactNode;
}) {
    if (load.state === "loading") {
        return (
            <View style={styles.card}>
                <Skeleton variant="row" count={5} label={label} />
            </View>
        );
    }
    if (load.state === "error") {
        return (
            <LoadFailed
                variant="card"
                message={error}
                onRetry={load.retry}
                retrying={load.retrying}
            />
        );
    }
    return <>{children}</>;
}

function RestockSheet({
    item,
    suggested,
    onClose,
    onDone,
}: {
    item: ItemRow;
    suggested: number;
    onClose: () => void;
    onDone: (n: number) => void;
}) {
    const form = useRestockForm(api, item, onDone);
    return (
        <Modal open onClose={onClose}>
            <View style={styles.sheetHead}>
                <ItemImage
                    src={mediaUrl(apiBaseUrl, item.image_file_id)}
                    name={item.name}
                    color={item.color}
                    size={44}
                />
                <View style={styles.flex}>
                    <Text style={styles.sheetTitle} numberOfLines={2}>
                        {s.restockTitle(item.name)}
                    </Text>
                    <Text style={styles.meta}>{s.restockAfter(form.after)}</Text>
                </View>
            </View>
            <TextField
                label={s.restockQuantity}
                type="number"
                value={form.quantity}
                onChange={form.setQuantity}
            />
            {suggested > 0 ? (
                <View style={styles.suggest}>
                    <Button
                        size="sm"
                        variant="outline"
                        onPress={() => {
                            form.setQuantity(String(suggested));
                        }}
                    >
                        {s.suggested(suggested)}
                    </Button>
                </View>
            ) : null}
            <TextField
                label={s.restockNote}
                placeholder={s.restockNotePlaceholder}
                optional
                value={form.note}
                onChange={form.setNote}
            />
            <Text style={styles.meta}>{s.restockQuantityHint}</Text>
            {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
            <View style={styles.foot}>
                <Button size="lg" full onPress={form.submit} busy={form.busy}>
                    {form.busy ? s.restocking : s.restockSave}
                </Button>
            </View>
        </Modal>
    );
}

function StockCard({ r, onRestock }: { r: StockRowView; onRestock: () => void }) {
    return (
        <View style={styles.row}>
            <ItemImage
                src={mediaUrl(apiBaseUrl, r.item.image_file_id)}
                name={r.item.name}
                color={r.item.color}
                size={44}
            />
            <View style={[styles.flex, styles.stack]}>
                <Text style={styles.name} numberOfLines={1}>
                    {r.item.name}
                </Text>
                <Meter
                    value={Math.max(0, r.onHand)}
                    max={stockScale(r.onHand, r.lowAt)}
                    marker={r.lowAt}
                    intent={r.intent}
                    label={r.label}
                    labelPosition="beside"
                    size="sm"
                />
                {r.detail !== "" ? (
                    <Text style={styles.meta} numberOfLines={1}>
                        {r.detail}
                    </Text>
                ) : null}
                {r.low && r.suggested > 0 ? (
                    <Text style={styles.suggestLine} numberOfLines={1}>
                        {s.suggested(r.suggested)}
                    </Text>
                ) : null}
            </View>
            <Button
                style={{ alignSelf: "center" }}
                size="sm"
                variant={r.low ? "primary" : "outline"}
                onPress={onRestock}
            >
                {s.restock}
            </Button>
        </View>
    );
}

/** Tracked products, most urgent first, with one-tap restock and a way into receiving a delivery. */
export function Inventory() {
    const inv = useInventory();
    const moves = useStockMoves(10);
    const [restocking, setRestocking] = useState<StockRowView | null>(null);
    const [done, setDone] = useState<string | null>(null);
    const [receiving, setReceiving] = useState(false);

    if (receiving) {
        return (
            <ReceiveDelivery
                seed={inv.attention.map((r) => ({
                    itemId: r.item.id,
                    quantity: Math.max(1, r.suggested),
                }))}
                onBack={() => {
                    setReceiving(false);
                }}
            />
        );
    }

    const cards = (list: StockRowView[]) =>
        list.map((r, i) => (
            <View key={r.item.id} style={i > 0 && styles.divider}>
                <StockCard
                    r={r}
                    onRestock={() => {
                        setDone(null);
                        setRestocking(r);
                    }}
                />
            </View>
        ));

    return (
        <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.head}>
                <Text style={[styles.meta, styles.flex]}>{s.inventorySubtitle}</Text>
                <Button
                    style={{ alignSelf: "center" }}
                    size="sm"
                    variant="outline"
                    disabled={!inv.load.ready}
                    onPress={() => {
                        setReceiving(true);
                    }}
                >
                    {s.receive}
                </Button>
            </View>
            {inv.load.state === "empty" ? (
                <Empty
                    variant="card"
                    icon="box"
                    message={s.emptyStockTitle}
                    body={s.emptyStockBody}
                />
            ) : (
                <Loaded load={inv.load} label={s.loadingStock} error={s.loadErrorStock}>
                    <View style={styles.stats}>
                        <View style={styles.stat}>
                            <Text style={styles.statLabel}>{s.statLow}</Text>
                            <Text style={[styles.statValue, inv.stats.low > 0 && styles.warn]}>
                                {String(inv.stats.low)}
                            </Text>
                        </View>
                        <View style={styles.stat}>
                            <Text style={styles.statLabel}>{s.statOut}</Text>
                            <Text style={[styles.statValue, inv.stats.out > 0 && styles.danger]}>
                                {String(inv.stats.out)}
                            </Text>
                        </View>
                        <View style={[styles.stat, styles.statWide]}>
                            <Text style={styles.statLabel}>{s.statValue}</Text>
                            <Text style={styles.statValue}>{formatMoney(inv.stats.costCents)}</Text>
                        </View>
                    </View>
                    {done !== null ? (
                        <Notice tone="success" banner>
                            {done}
                        </Notice>
                    ) : null}
                    <Text style={styles.section}>{s.needsRestock}</Text>
                    <View style={styles.card}>
                        {inv.attention.length === 0 ? (
                            <Text style={styles.empty}>{s.allGood}</Text>
                        ) : (
                            cards(inv.attention)
                        )}
                    </View>
                    {inv.others.length > 0 ? (
                        <>
                            <Text style={styles.section}>{s.allTracked}</Text>
                            <View style={styles.card}>{cards(inv.others)}</View>
                        </>
                    ) : null}
                    <Panel title={s.recentMoves}>
                        {moves.length === 0 ? (
                            <Text style={styles.meta}>{s.noMoves}</Text>
                        ) : (
                            <ActivityTimeline entries={moves} />
                        )}
                    </Panel>
                </Loaded>
            )}
            {restocking !== null ? (
                <RestockSheet
                    item={restocking.item}
                    suggested={restocking.suggested}
                    onClose={() => {
                        setRestocking(null);
                    }}
                    onDone={(n) => {
                        setDone(s.restockDone(n, restocking.item.name));
                        setRestocking(null);
                    }}
                />
            ) : null}
        </ScrollView>
    );
}

function ReceiveDelivery({
    seed,
    onBack,
}: {
    seed: readonly { itemId: string; quantity: number }[];
    onBack: () => void;
}) {
    const d = useReceiveDelivery(api, seed);
    return (
        <View style={styles.screen}>
            <ScrollView contentContainerStyle={styles.body}>
                <View style={styles.back}>
                    <Button variant="link" icon="chevronLeft" onPress={onBack}>
                        {s.backToInventory}
                    </Button>
                </View>
                <Text style={styles.title}>{s.receiveTitle}</Text>
                <Text style={styles.meta}>{s.receiveSubtitle}</Text>
                {d.load.state === "empty" ? (
                    <Empty
                        variant="card"
                        icon="box"
                        message={s.emptyDeliveryTitle}
                        body={s.emptyDeliveryBody}
                    />
                ) : (
                    <Loaded load={d.load} label={s.loadingProducts} error={s.loadErrorProducts}>
                        <TextField
                            label={s.supplier}
                            placeholder={s.supplierPlaceholder}
                            optional
                            value={d.supplier}
                            onChange={d.setSupplier}
                        />
                        <TextField
                            label={s.reference}
                            placeholder={s.referencePlaceholder}
                            optional
                            value={d.reference}
                            onChange={d.setReference}
                        />
                        <View style={styles.search}>
                            <SearchField value={d.q} onChange={d.setQ} placeholder={s.addSearch} />
                        </View>
                        {d.candidates.length > 0 ? (
                            <View style={styles.card}>
                                {d.candidates.map((i) => (
                                    <ListRow
                                        key={i.id}
                                        density="compact"
                                        leading={
                                            <ItemImage
                                                src={mediaUrl(apiBaseUrl, i.image_file_id)}
                                                name={i.name}
                                                color={i.color}
                                                size={30}
                                            />
                                        }
                                        title={i.name}
                                        meta={s.onHandShort(i.stock_on_hand ?? 0)}
                                        onPress={() => {
                                            d.add(i);
                                        }}
                                    />
                                ))}
                            </View>
                        ) : null}
                        <View style={styles.card}>
                            {d.lines.length === 0 ? (
                                <Text style={styles.empty}>{s.deliveryEmpty}</Text>
                            ) : null}
                            {d.lines.map((l, n) => (
                                <View
                                    key={l.item.id}
                                    style={[styles.line, n > 0 && styles.divider]}
                                >
                                    <View style={styles.lineTop}>
                                        <ItemImage
                                            src={mediaUrl(apiBaseUrl, l.item.image_file_id)}
                                            name={l.item.name}
                                            color={l.item.color}
                                            size={40}
                                        />
                                        <View style={styles.flex}>
                                            <Text style={styles.name} numberOfLines={1}>
                                                {l.item.name}
                                            </Text>
                                            <Text style={styles.meta}>
                                                {s.onHandAfter(
                                                    l.item.stock_on_hand ?? 0,
                                                    d.after(l),
                                                )}
                                            </Text>
                                        </View>
                                        <IconButton
                                            icon="x"
                                            size="sm"
                                            label={s.removeLine(l.item.name)}
                                            onPress={() => {
                                                d.remove(l.item.id);
                                            }}
                                        />
                                    </View>
                                    <View style={styles.lineBottom}>
                                        <Stepper
                                            value={Number(l.quantity) || 0}
                                            min={0}
                                            label={s.receivedFor(l.item.name)}
                                            onChange={(v) => {
                                                d.setQuantity(l.item.id, String(v));
                                            }}
                                        />
                                        {d.stillLow(l) ? (
                                            <Badge
                                                style={{ alignSelf: "center" }}
                                                label={s.lowAfter}
                                                intent="warning"
                                            />
                                        ) : (
                                            <View />
                                        )}
                                        <Text style={styles.cost}>
                                            {formatMoney(d.lineCost(l))}
                                        </Text>
                                    </View>
                                    <TextField
                                        label={s.colUnitCost}
                                        type="number"
                                        prefix="$"
                                        size="sm"
                                        value={l.unitCost}
                                        onChange={(v) => {
                                            d.setUnitCost(l.item.id, v);
                                        }}
                                    />
                                </View>
                            ))}
                        </View>
                        <Text style={styles.meta}>{s.unitCostHint}</Text>
                        {d.error !== null ? (
                            <Notice tone="danger" banner>
                                {d.error}
                            </Notice>
                        ) : null}
                        {d.done !== null ? (
                            <Notice tone="success" banner>
                                {d.done}
                            </Notice>
                        ) : null}
                    </Loaded>
                )}
            </ScrollView>
            {d.load.ready ? (
                <View style={styles.bar}>
                    <Text style={styles.total}>
                        {s.deliveryTotal(d.units, formatMoney(d.costCents))}
                    </Text>
                    <Button
                        style={{ alignSelf: "center" }}
                        onPress={d.submit}
                        busy={d.busy}
                        disabled={d.lines.length === 0}
                    >
                        {d.busy ? s.restocking : s.receiveSave(d.lines.length)}
                    </Button>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    flex: { flex: 1, minWidth: 0 },
    stack: { gap: 4 },
    body: { padding: 16, paddingBottom: 32, gap: 10 },
    head: { flexDirection: "row", alignItems: "center", gap: 12 },
    back: { flexDirection: "row" },
    title: { color: c.ink, fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
    stats: { flexDirection: "row", gap: 8 },
    stat: {
        flex: 1,
        padding: 12,
        borderRadius: theme.radius + 2,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
    },
    statWide: { flex: 1.6 },
    statLabel: { color: c.muted, fontSize: 12 },
    statValue: {
        color: c.ink,
        fontSize: 21,
        fontWeight: "800",
        marginTop: 2,
        fontVariant: ["tabular-nums"],
    },
    warn: { color: c.warnFg },
    danger: { color: c.danFg },
    section: {
        color: c.muted,
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        marginTop: 8,
    },
    card: {
        borderRadius: theme.radius + 2,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        paddingHorizontal: 12,
        overflow: "hidden",
    },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderSoft },
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
    name: { color: c.ink, fontSize: 15, fontWeight: "600" },
    meta: { color: c.muted, fontSize: 12.5, marginTop: 2, lineHeight: 17 },
    empty: { color: c.muted, fontSize: 14, paddingVertical: 20, textAlign: "center" },
    suggestLine: { color: c.inkSoft, fontSize: 12.5, fontWeight: "600" },
    sheetHead: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 },
    sheetTitle: { color: c.ink, fontSize: 17, fontWeight: "700" },
    suggest: { marginTop: 8, flexDirection: "row" },
    foot: { marginTop: 16 },
    search: { marginTop: 4 },
    line: { paddingVertical: 12, gap: 10 },
    lineTop: { flexDirection: "row", alignItems: "center", gap: 10 },
    lineBottom: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    cost: { color: c.ink, fontSize: 14.5, fontWeight: "700", fontVariant: ["tabular-nums"] },
    bar: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: c.surface,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.border,
    },
    total: { flex: 1, color: c.ink, fontSize: 14.5, fontWeight: "600" },
});
