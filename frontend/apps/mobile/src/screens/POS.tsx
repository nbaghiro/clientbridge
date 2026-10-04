import {
    type EntitlementKind,
    canVoidSale,
    checkoutMethods,
    entitlementKindsOnSale,
    useClients,
    useSaleCheckout,
    useSavedCards,
    useStripeAccountId,
    type CartLine,
    type Order,
    filterItems,
    formatMoney,
    mediaUrl,
    orderStatusIntent,
    sellableItems,
    strings,
    useCart,
    useCatalogItems,
    useConnectionToken,
    useOnlineOrders,
    useOpenOrders,
    usePickupAction,
    PICKUP_LABEL,
    formatMoneyWithCurrency,
    pickupActions,
    pickupIntent,
    useSearch,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useMemo, useState } from "react";
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

import {
    ClientChips,
    SellGiftCard,
    SellPackage,
    StartSubscription,
} from "../components/EntitlementSales";
import { IconSearch } from "../components/icons";
import { ChargeSheet } from "../ui/ChargeSheet";
import { useRole } from "../lib/auth";
import { ItemImage } from "../ui/ItemImage";
import { StatusPill } from "../ui/StatusPill";
import { ui } from "../ui/styles";
import { TerminalProvider, useTerminalCheckout } from "../components/terminal";
import { api, apiBaseUrl } from "../lib/api";

const c = theme.colors;

export function POSScreen() {
    const cart = useCart(api);
    const canVoid = canVoidSale(useRole());
    const items = useCatalogItems();
    const active = useMemo(() => sellableItems(items), [items]);
    const { q, setQ, filtered } = useSearch(active, filterItems);
    const reviewing = cart.phase === "awaiting_reader";
    const tokenProvider = useConnectionToken(api); // feeds the Terminal SDK its connection token
    const entitlements = useMemo(() => entitlementKindsOnSale(items), [items]);
    const [selling, setSelling] = useState<EntitlementKind | null>(null);
    const [payingByCard, setPayingByCard] = useState(false);

    if (cart.phase === "paid" && cart.order !== null) {
        return (
            <View style={[styles.screen, styles.reader]}>
                <Text style={styles.readerTitle}>{strings.pos.paidTitle}</Text>
                <Text style={styles.readerSub}>
                    {strings.pos.paidBody(formatMoney(cart.order.total_cents))}
                </Text>
                <Pressable
                    style={styles.charge}
                    onPress={() => {
                        setPayingByCard(false);
                        cart.newSale();
                    }}
                >
                    <Text style={styles.chargeText}>{strings.pos.newSale}</Text>
                </Pressable>
            </View>
        );
    }

    if (payingByCard && cart.phase === "review" && cart.order !== null) {
        return (
            <ScrollView style={styles.screen} contentContainerStyle={styles.reader}>
                <Totals order={cart.order} />
                <CardPayment
                    cart={cart}
                    onCancel={() => {
                        setPayingByCard(false);
                    }}
                />
            </ScrollView>
        );
    }

    return (
        <View style={styles.screen}>
            {reviewing && cart.checkoutResult !== null && cart.order !== null ? (
                <TerminalProvider tokenProvider={tokenProvider}>
                    <ReaderPanel
                        order={cart.order}
                        clientSecret={cart.checkoutResult.client_secret}
                        onDone={cart.newSale}
                        onVoid={canVoid ? cart.voidSale : undefined}
                        busy={cart.busy}
                    />
                </TerminalProvider>
            ) : (
                <>
                    <View style={styles.searchWrap}>
                        <IconSearch size={16} color={c.muted} />
                        <TextInput
                            style={styles.search}
                            value={q}
                            onChangeText={setQ}
                            placeholder={strings.pos.searchPlaceholder}
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
                                <ItemImage
                                    src={mediaUrl(apiBaseUrl, item.image_file_id)}
                                    name={item.name}
                                    color={item.color}
                                    size={44}
                                />
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
                                {q ? strings.pos.searchEmpty : strings.pos.empty}
                            </Text>
                        }
                        ListFooterComponent={
                            <>
                                {entitlements.length > 0 ? (
                                    <View style={styles.openOrders}>
                                        <Text style={styles.openTitle}>{strings.pos.alsoSell}</Text>
                                        <View style={ui.chipWrap}>
                                            {entitlements.map((kind) => (
                                                <Pressable
                                                    key={kind}
                                                    style={[
                                                        ui.chip,
                                                        selling === kind ? ui.chipOn : null,
                                                    ]}
                                                    onPress={() => {
                                                        setSelling(selling === kind ? null : kind);
                                                    }}
                                                >
                                                    <Text
                                                        style={[
                                                            ui.chipText,
                                                            selling === kind ? ui.chipTextOn : null,
                                                        ]}
                                                    >
                                                        {ENTITLEMENT_LABEL[kind]}
                                                    </Text>
                                                </Pressable>
                                            ))}
                                        </View>
                                        {selling !== null ? (
                                            <EntitlementSale
                                                kind={selling}
                                                onClose={() => {
                                                    setSelling(null);
                                                }}
                                            />
                                        ) : null}
                                    </View>
                                ) : null}
                                <OnlineOrders />
                                <OpenOrders />
                            </>
                        }
                    />

                    <CartBar
                        cart={cart}
                        onCard={() => {
                            setPayingByCard(true);
                        }}
                    />
                </>
            )}
        </View>
    );
}

const ENTITLEMENT_LABEL: Record<EntitlementKind, string> = {
    gift: strings.pos.sellGiftCard,
    package: strings.pos.sellPackage,
    subscription: strings.pos.sellSubscription,
};

function EntitlementSale({ kind, onClose }: { kind: EntitlementKind; onClose: () => void }) {
    if (kind === "gift") return <SellGiftCard onClose={onClose} />;
    if (kind === "package") return <SellPackage clientId={null} onClose={onClose} />;
    return <StartSubscription clientId={null} onClose={onClose} />;
}

function CardPayment({
    cart,
    onCancel,
}: {
    cart: ReturnType<typeof useCart>;
    onCancel: () => void;
}) {
    const cards = useSavedCards(cart.clientId ?? "");
    const methods = checkoutMethods(cards);
    const sale = useSaleCheckout(api, cart, methods[0]?.id);
    const stripeAccount = useStripeAccountId() ?? "";
    if (cart.order === null) return null;
    return (
        <ChargeSheet
            checkout={sale.checkout}
            methods={methods}
            amountLabel={formatMoney(cart.order.total_cents)}
            stripeAccount={stripeAccount}
            submitLabel={strings.pos.payCard}
            busyLabel={strings.pos.paying}
            onSubmit={sale.submit}
            onCancel={onCancel}
        />
    );
}

function SaleDetails({ cart }: { cart: ReturnType<typeof useCart> }) {
    const clients = useClients();
    const [open, setOpen] = useState(false);
    const client = clients.find((cl) => cl.id === cart.clientId);
    return (
        <View>
            <Pressable
                style={styles.detailsToggle}
                onPress={() => {
                    setOpen(!open);
                }}
            >
                <Text style={styles.detailsText} numberOfLines={1}>
                    {strings.pos.clientLabel}: {client?.name ?? strings.pos.walkIn}
                </Text>
                <Text style={styles.detailsText}>{open ? "−" : "+"}</Text>
            </Pressable>
            {open ? (
                <View style={styles.details}>
                    <ClientChips
                        clients={clients}
                        value={cart.clientId ?? ""}
                        onChange={(id) => {
                            cart.setClientId(id === "" ? null : id);
                        }}
                    />
                    <Text style={ui.label}>{strings.pos.receiptEmail}</Text>
                    <TextInput
                        style={styles.detailsInput}
                        value={cart.receiptEmail}
                        onChangeText={cart.setReceiptEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                    />
                    <Text style={ui.label}>{strings.pos.receiptPhone}</Text>
                    <TextInput
                        style={styles.detailsInput}
                        value={cart.receiptPhone}
                        onChangeText={cart.setReceiptPhone}
                        keyboardType="phone-pad"
                    />
                    <Text style={ui.note}>{strings.pos.receiptHint}</Text>
                </View>
            ) : null}
        </View>
    );
}

function CartBar({ cart, onCard }: { cart: ReturnType<typeof useCart>; onCard: () => void }) {
    return (
        <View style={styles.cart}>
            <SaleDetails cart={cart} />
            {cart.isEmpty ? (
                <Text style={styles.cartEmpty}>{strings.pos.cartEmptyStart}</Text>
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
                                {strings.pos.tapToPay} · {formatMoney(cart.order.total_cents)}
                            </Text>
                        )}
                    </Pressable>
                    <Pressable style={styles.secondary} onPress={onCard} disabled={cart.busy}>
                        <Text style={styles.secondaryText}>{strings.pos.payCard}</Text>
                    </Pressable>
                </>
            ) : (
                <>
                    <View style={styles.subtotalRow}>
                        <Text style={styles.subtotalLabel}>{strings.pos.subtotal}</Text>
                        <Text style={styles.subtotalValue}>
                            {formatMoney(cart.subtotalCents)}
                            <Text style={styles.subtotalTax}>{strings.pos.plusTax}</Text>
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
                            <Text style={styles.chargeText}>{strings.pos.reviewTotal}</Text>
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
                <Text style={styles.lineUnit}>
                    {strings.pos.unitEach(formatMoney(line.unitAmountCents))}
                </Text>
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
            <TotalRow label={strings.pos.subtotal} cents={order.subtotal_cents} />
            <TotalRow label={strings.pos.tax} cents={order.tax_total_cents} />
            <View style={[styles.totalRow, styles.totalGrand]}>
                <Text style={styles.grandLabel}>{strings.pos.total}</Text>
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
    onVoid: (() => void) | undefined;
    busy: boolean;
}) {
    const terminal = useTerminalCheckout();
    const status =
        terminal.phase === "connecting"
            ? strings.pos.readerConnecting
            : terminal.phase === "ready"
              ? strings.pos.readerReady
              : terminal.phase === "collecting"
                ? strings.pos.readerCollecting
                : terminal.phase === "done"
                  ? strings.pos.readerApproved
                  : strings.pos.readerUnavailable;

    return (
        <ScrollView contentContainerStyle={styles.reader}>
            <Text style={styles.readerTitle}>{strings.pos.readerTitle}</Text>
            <Text style={styles.readerSub}>
                {strings.pos.readerCollect(formatMoney(order.total_cents))}
            </Text>
            <View style={styles.readerBox}>
                <Text style={styles.readerWaiting}>{status}</Text>
                {terminal.error !== null ? (
                    <Text style={styles.readerNote}>{terminal.error}</Text>
                ) : null}
                <Text style={styles.readerNote}>{strings.pos.readerRequirements}</Text>
            </View>
            {terminal.phase === "done" ? (
                <Pressable style={styles.charge} onPress={onDone}>
                    <Text style={styles.chargeText}>{strings.pos.newSale}</Text>
                </Pressable>
            ) : (
                <Pressable
                    style={styles.charge}
                    disabled={!terminal.ready || terminal.phase === "collecting"}
                    onPress={() => {
                        terminal.charge(clientSecret);
                    }}
                >
                    <Text style={styles.chargeText}>
                        {strings.pos.collect(formatMoney(order.total_cents))}
                    </Text>
                </Pressable>
            )}
            {onVoid !== undefined ? (
                <Pressable style={styles.void} onPress={onVoid} disabled={busy}>
                    <Text style={styles.voidText}>{strings.pos.voidSale}</Text>
                </Pressable>
            ) : null}
        </ScrollView>
    );
}

function OnlineOrders() {
    const orders = useOnlineOrders();
    const pickup = usePickupAction(api);
    if (orders.length === 0) return null;

    return (
        <View style={styles.openOrders}>
            <Text style={styles.openTitle}>{strings.pos.onlineOrders}</Text>
            {orders.map((order) => (
                <View key={order.id} style={styles.onlineRow}>
                    <View style={styles.onlineHead}>
                        <Text style={styles.openName} numberOfLines={1}>
                            {order.client_name ?? strings.pos.walkIn}
                        </Text>
                        <StatusPill
                            status={PICKUP_LABEL[order.pickup_status]}
                            intent={pickupIntent(order.pickup_status)}
                            asWritten
                        />
                        <Text style={styles.openValue}>
                            {formatMoneyWithCurrency(order.total_cents, order.currency)}
                        </Text>
                    </View>
                    {order.summary !== null ? <Text style={ui.note}>{order.summary}</Text> : null}
                    <View style={ui.chipWrap}>
                        {pickupActions(order.pickup_status).map((step) => (
                            <Pressable
                                key={step.status}
                                disabled={pickup.busy}
                                onPress={() => {
                                    pickup.advance(order.id, step.status);
                                }}
                                style={ui.chip}
                            >
                                <Text style={ui.chipText}>{step.label}</Text>
                            </Pressable>
                        ))}
                    </View>
                </View>
            ))}
            {pickup.error !== null ? <Text style={ui.error}>{pickup.error}</Text> : null}
        </View>
    );
}

function OpenOrders() {
    const orders = useOpenOrders();
    if (orders.length === 0) return null;

    return (
        <View style={styles.openOrders}>
            <Text style={styles.openTitle}>{strings.pos.openOrders}</Text>
            {orders.map((order) => (
                <View key={order.id} style={styles.openRow}>
                    <Text style={styles.openName} numberOfLines={1}>
                        {order.client_name ?? strings.pos.walkIn}
                    </Text>
                    <StatusPill status={order.status} intent={orderStatusIntent(order.status)} />
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
    tileName: { color: c.ink, fontSize: 14, fontWeight: "600", marginTop: 8 },
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
    detailsToggle: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingBottom: 8,
    },
    detailsText: { color: c.inkSoft, fontSize: 13, fontWeight: "600" },
    details: { paddingBottom: 10 },
    detailsInput: {
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        paddingHorizontal: 12,
        paddingVertical: 8,
        color: c.ink,
        fontSize: 14,
        backgroundColor: c.bg,
    },
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
    onlineRow: {
        gap: 8,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
    },
    onlineHead: { flexDirection: "row", alignItems: "center", gap: 10 },
    openName: { flex: 1, color: c.ink, fontSize: 14 },
    openValue: { color: c.ink, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
});
