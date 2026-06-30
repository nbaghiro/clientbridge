import {
    type CartLine,
    type Order,
    filterItems,
    formatMoney,
    orderStatusIntent,
    sellableItems,
    useCart,
    useCatalogItems,
    useConnectionToken,
    useOpenOrders,
    useSearch,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useMemo } from "react";
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { IconSearch } from "../components/icons";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";

const c = theme.colors;

export function POSScreen() {
    const cart = useCart(api);
    const items = useCatalogItems();
    const active = useMemo(() => sellableItems(items), [items]);
    const { q, setQ, filtered } = useSearch(active, filterItems);
    const reviewing = cart.phase === "awaiting_reader";

    return (
        <SafeAreaView style={styles.screen} edges={["bottom"]}>
            {reviewing && cart.checkoutResult !== null && cart.order !== null ? (
                <ReaderPanel
                    order={cart.order}
                    clientSecret={cart.checkoutResult.client_secret}
                    onDone={cart.newSale}
                    onVoid={cart.voidSale}
                    busy={cart.busy}
                />
            ) : (
                <>
                    <View style={styles.searchWrap}>
                        <IconSearch size={16} color={c.muted} />
                        <TextInput
                            style={styles.search}
                            value={q}
                            onChangeText={setQ}
                            placeholder="Search catalog…"
                            placeholderTextColor={c.muted}
                            autoCapitalize="none"
                        />
                    </View>

                    <FlatList
                        data={filtered}
                        keyExtractor={(i) => i.id}
                        numColumns={2}
                        columnWrapperStyle={styles.gridRow}
                        contentContainerStyle={styles.grid}
                        renderItem={({ item }) => (
                            <Pressable
                                style={styles.tile}
                                onPress={() => {
                                    cart.addItem(item);
                                }}
                            >
                                <Text style={styles.tileName} numberOfLines={2}>
                                    {item.name}
                                </Text>
                                <Text style={styles.tilePrice}>
                                    {formatMoney(item.price_cents)}
                                </Text>
                            </Pressable>
                        )}
                        ListEmptyComponent={
                            <Text style={styles.empty}>
                                {q ? "No items match your search." : "No sellable items yet."}
                            </Text>
                        }
                        ListFooterComponent={<OpenOrders />}
                    />

                    <CartBar cart={cart} />
                </>
            )}
        </SafeAreaView>
    );
}

function CartBar({ cart }: { cart: ReturnType<typeof useCart> }) {
    return (
        <View style={styles.cart}>
            {cart.isEmpty ? (
                <Text style={styles.cartEmpty}>Tap a catalog item to start a sale.</Text>
            ) : (
                <ScrollView style={styles.cartLines}>
                    {cart.lines.map((line) => (
                        <CartLineRow
                            key={line.key}
                            line={line}
                            onQuantity={(qty) => {
                                cart.setQuantity(line.key, qty);
                            }}
                            onRemove={() => {
                                cart.removeLine(line.key);
                            }}
                        />
                    ))}
                </ScrollView>
            )}

            {cart.phase === "review" && cart.order !== null ? (
                <>
                    <Totals order={cart.order} />
                    <Pressable style={styles.charge} onPress={cart.charge} disabled={cart.busy}>
                        {cart.busy ? (
                            <ActivityIndicator color={c.accentInk} />
                        ) : (
                            <Text style={styles.chargeText}>
                                Charge {formatMoney(cart.order.total_cents)}
                            </Text>
                        )}
                    </Pressable>
                </>
            ) : (
                <>
                    <View style={styles.subtotalRow}>
                        <Text style={styles.subtotalLabel}>Subtotal</Text>
                        <Text style={styles.subtotalValue}>
                            {formatMoney(cart.subtotalCents)}
                            <Text style={styles.subtotalTax}> + tax</Text>
                        </Text>
                    </View>
                    <Pressable
                        style={[styles.charge, cart.isEmpty && styles.disabled]}
                        onPress={cart.review}
                        disabled={cart.busy || cart.isEmpty}
                    >
                        {cart.busy ? (
                            <ActivityIndicator color={c.accentInk} />
                        ) : (
                            <Text style={styles.chargeText}>Review total</Text>
                        )}
                    </Pressable>
                </>
            )}
            {cart.error !== null ? <Text style={styles.error}>{cart.error}</Text> : null}
        </View>
    );
}

function CartLineRow({
    line,
    onQuantity,
    onRemove,
}: {
    line: CartLine;
    onQuantity: (quantity: number) => void;
    onRemove: () => void;
}) {
    return (
        <View style={styles.lineRow}>
            <View style={styles.lineMain}>
                <Text style={styles.lineName} numberOfLines={1}>
                    {line.description}
                </Text>
                <Text style={styles.lineUnit}>{formatMoney(line.unitAmountCents)} each</Text>
            </View>
            <View style={styles.stepper}>
                <Pressable
                    style={styles.qtyBtn}
                    onPress={() => {
                        onQuantity(line.quantity - 1);
                    }}
                >
                    <Text style={styles.qtyText}>−</Text>
                </Pressable>
                <Text style={styles.qty}>{line.quantity}</Text>
                <Pressable
                    style={styles.qtyBtn}
                    onPress={() => {
                        onQuantity(line.quantity + 1);
                    }}
                >
                    <Text style={styles.qtyText}>+</Text>
                </Pressable>
            </View>
            <Pressable onPress={onRemove} hitSlop={8}>
                <Text style={styles.remove}>×</Text>
            </Pressable>
        </View>
    );
}

function Totals({ order }: { order: Order }) {
    return (
        <View style={styles.totals}>
            <TotalRow label="Subtotal" cents={order.subtotal_cents} />
            <TotalRow label="Tax" cents={order.tax_total_cents} />
            <View style={[styles.totalRow, styles.totalGrand]}>
                <Text style={styles.grandLabel}>Total</Text>
                <Text style={styles.grandValue}>{formatMoney(order.total_cents)}</Text>
            </View>
        </View>
    );
}

function TotalRow({ label, cents }: { label: string; cents: number }) {
    return (
        <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{label}</Text>
            <Text style={styles.totalValue}>{formatMoney(cents)}</Text>
        </View>
    );
}

function ReaderPanel({
    order,
    clientSecret,
    onDone,
    onVoid,
    busy,
}: {
    order: Order;
    clientSecret: string;
    onDone: () => void;
    onVoid: () => void;
    busy: boolean;
}) {
    // The native Stripe Terminal SDK confirmation is the follow-up; here we only acquire the reader
    // token (the seam the SDK consumes) and surface the created PaymentIntent.
    const tokenProvider = useConnectionToken(api);

    return (
        <ScrollView contentContainerStyle={styles.reader}>
            <Text style={styles.readerTitle}>Charge on reader</Text>
            <Text style={styles.readerSub}>
                Tap, insert, or swipe the card to collect {formatMoney(order.total_cents)}.
            </Text>
            <View style={styles.readerBox}>
                <Text style={styles.readerWaiting}>Waiting for card…</Text>
                <Text style={styles.readerNote}>
                    Card-present capture needs the native Terminal SDK (not wired in this build).
                </Text>
            </View>
            <Text style={styles.readerSecret} numberOfLines={1}>
                PaymentIntent: {clientSecret}
            </Text>
            <Pressable
                style={styles.secondary}
                onPress={() => {
                    void tokenProvider();
                }}
            >
                <Text style={styles.secondaryText}>Pair reader</Text>
            </Pressable>
            <Pressable style={styles.charge} onPress={onDone}>
                <Text style={styles.chargeText}>New sale</Text>
            </Pressable>
            <Pressable style={styles.void} onPress={onVoid} disabled={busy}>
                <Text style={styles.voidText}>Void this sale</Text>
            </Pressable>
        </ScrollView>
    );
}

function OpenOrders() {
    const orders = useOpenOrders();
    if (orders.length === 0) return null;

    return (
        <View style={styles.openOrders}>
            <Text style={styles.openTitle}>Open orders</Text>
            {orders.map((order) => (
                <View key={order.id} style={styles.openRow}>
                    <Text style={styles.openName} numberOfLines={1}>
                        {order.client_name ?? "Walk-in"}
                    </Text>
                    <StatusBadge status={order.status} intent={orderStatusIntent(order.status)} />
                    <Text style={styles.openValue}>{formatMoney(order.total_cents)}</Text>
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    searchWrap: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        margin: 16,
        marginBottom: 8,
        paddingHorizontal: 12,
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        backgroundColor: c.surface,
    },
    search: { flex: 1, paddingVertical: 11, color: c.ink, fontSize: 15 },
    grid: { paddingHorizontal: 16, paddingBottom: 16 },
    gridRow: { gap: 12 },
    tile: {
        flex: 1,
        marginBottom: 12,
        padding: 12,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        minHeight: 72,
        justifyContent: "space-between",
    },
    tileName: { color: c.ink, fontSize: 14, fontWeight: "600" },
    tilePrice: { color: c.muted, fontSize: 14, marginTop: 6, fontVariant: ["tabular-nums"] },
    empty: { color: c.muted, textAlign: "center", paddingVertical: 40, fontSize: 14 },
    cart: {
        borderTopColor: c.border,
        borderTopWidth: 1,
        backgroundColor: c.surface,
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 14,
    },
    cartEmpty: { color: c.muted, fontSize: 14, paddingVertical: 8 },
    cartLines: { maxHeight: 180 },
    lineRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 8,
        borderBottomColor: c.borderSoft,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    lineMain: { flex: 1 },
    lineName: { color: c.ink, fontSize: 14, fontWeight: "600" },
    lineUnit: { color: c.muted, fontSize: 12, marginTop: 1, fontVariant: ["tabular-nums"] },
    stepper: { flexDirection: "row", alignItems: "center", gap: 8 },
    qtyBtn: {
        width: 26,
        height: 26,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: c.border,
        alignItems: "center",
        justifyContent: "center",
    },
    qtyText: { color: c.inkSoft, fontSize: 16 },
    qty: { color: c.ink, fontSize: 14, minWidth: 18, textAlign: "center" },
    remove: { color: c.muted, fontSize: 20, paddingHorizontal: 4 },
    subtotalRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 8,
    },
    subtotalLabel: { color: c.muted, fontSize: 14 },
    subtotalValue: { color: c.ink, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
    subtotalTax: { color: c.muted, fontSize: 12, fontWeight: "400" },
    totals: { marginTop: 8, gap: 4 },
    totalRow: { flexDirection: "row", justifyContent: "space-between" },
    totalLabel: { color: c.muted, fontSize: 14 },
    totalValue: { color: c.inkSoft, fontSize: 14, fontVariant: ["tabular-nums"] },
    totalGrand: {
        borderTopColor: c.borderSoft,
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingTop: 4,
    },
    grandLabel: { color: c.ink, fontSize: 15, fontWeight: "700" },
    grandValue: { color: c.ink, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
    charge: {
        marginTop: 12,
        backgroundColor: c.accent,
        borderRadius: theme.radius,
        paddingVertical: 13,
        alignItems: "center",
    },
    chargeText: { color: c.accentInk, fontSize: 15, fontWeight: "700" },
    disabled: { opacity: 0.5 },
    error: { color: c.danFg, fontSize: 13, marginTop: 8 },
    reader: { padding: 20, gap: 12 },
    readerTitle: { color: c.ink, fontSize: 20, fontWeight: "700" },
    readerSub: { color: c.muted, fontSize: 14 },
    readerBox: {
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: c.accentLine,
        backgroundColor: c.accentWeak,
        borderRadius: theme.radius,
        padding: 18,
        alignItems: "center",
    },
    readerWaiting: { color: c.accentStrong, fontSize: 15, fontWeight: "600" },
    readerNote: { color: c.muted, fontSize: 12, marginTop: 6, textAlign: "center" },
    readerSecret: { color: c.muted, fontSize: 12 },
    secondary: {
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: theme.radius,
        paddingVertical: 12,
        alignItems: "center",
    },
    secondaryText: { color: c.inkSoft, fontSize: 14, fontWeight: "600" },
    void: { paddingVertical: 12, alignItems: "center" },
    voidText: { color: c.muted, fontSize: 14, fontWeight: "600" },
    openOrders: { marginTop: 8, gap: 6 },
    openTitle: { color: c.ink, fontSize: 15, fontWeight: "700", marginBottom: 2 },
    openRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
    },
    openName: { flex: 1, color: c.ink, fontSize: 14 },
    openValue: { color: c.ink, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
});
