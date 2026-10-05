import {
    type EntitlementKind,
    canVoidSale,
    type CartLine,
    checkoutMethods,
    entitlementKindsOnSale,
    useClients,
    useSaleCheckout,
    useSavedCards,
    type OpenOrderRow,
    type Order,
    filterItems,
    formatMoney,
    mediaUrl,
    orderStatusIntent,
    sellableItems,
    strings,
    useCart,
    useCatalogItems,
    useOnlineOrders,
    useOpenOrders,
    usePickupAction,
    PICKUP_LABEL,
    formatMoneyWithCurrency,
    pickupActions,
    pickupIntent,
    useSearch,
} from "@clientbridge/app-core";
import {
    Button,
    ChargeSheet,
    Choice,
    ItemImage,
    Notice,
    SearchField,
    StatusPill,
    TextField,
} from "@clientbridge/ui";
import { useMemo, useState } from "react";

import {
    ClientSelect,
    SellGiftCard,
    SellPackage,
    StartSubscription,
} from "../components/EntitlementSales";
import { api, apiBaseUrl } from "../lib/api";
import { useRole } from "../lib/auth";

export function POS() {
    const cart = useCart(api);
    const items = useCatalogItems();
    const active = useMemo(() => sellableItems(items), [items]);
    const entitlements = useMemo(() => entitlementKindsOnSale(items), [items]);
    const [selling, setSelling] = useState<EntitlementKind | null>(null);
    const { q, setQ, filtered } = useSearch(active, filterItems);

    return (
        <div className="flex gap-6">
            <section className="min-w-0 flex-1">
                <p className="text-sm text-muted">{strings.pos.subtitle}</p>

                <div className="mt-5">
                    <SearchField
                        value={q}
                        onChange={setQ}
                        placeholder={strings.pos.searchPlaceholder}
                    />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {filtered.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            disabled={cart.phase === "awaiting_reader"}
                            onClick={() => {
                                cart.addItem(item);
                            }}
                            className="flex flex-col items-start rounded-lg border border-line bg-surface p-3 text-left transition hover:border-accent disabled:opacity-50"
                        >
                            <ItemImage
                                src={mediaUrl(apiBaseUrl, item.image_file_id)}
                                name={item.name}
                                color={item.color}
                                size={48}
                            />
                            <span className="mt-2 line-clamp-2 text-sm font-medium text-ink">
                                {item.name}
                            </span>
                            <span className="mt-1 text-sm tabular-nums text-muted">
                                {formatMoney(item.price_cents)}
                            </span>
                        </button>
                    ))}
                    {filtered.length === 0 ? (
                        <p className="col-span-full py-12 text-center text-sm text-muted">
                            {q ? strings.pos.searchEmpty : strings.pos.emptyCatalog}
                        </p>
                    ) : null}
                </div>

                {entitlements.length > 0 ? (
                    <section className="mt-8">
                        <h2 className="font-display text-base font-semibold text-ink">
                            {strings.pos.alsoSell}
                        </h2>
                        <div className="mt-2">
                            <Choice
                                options={entitlements.map((kind) => ({
                                    key: kind,
                                    label: ENTITLEMENT_LABEL[kind],
                                }))}
                                value={selling}
                                onChange={(kind) => {
                                    setSelling(selling === kind ? null : kind);
                                }}
                            />
                        </div>
                        {selling !== null ? (
                            <div className="mt-3">
                                <EntitlementSale
                                    kind={selling}
                                    onClose={() => {
                                        setSelling(null);
                                    }}
                                />
                            </div>
                        ) : null}
                    </section>
                ) : null}

                <OnlineOrders />
                <OpenOrders />
            </section>

            <aside className="w-80 shrink-0">
                <CartPanel cart={cart} />
            </aside>
        </div>
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

function SaleDetails({ cart }: { cart: ReturnType<typeof useCart> }) {
    const clients = useClients();
    return (
        <div className="space-y-2 border-b border-line px-4 py-3">
            <ClientSelect
                label={strings.pos.clientLabel}
                clients={clients}
                value={cart.clientId ?? ""}
                onChange={(id) => {
                    cart.setClientId(id === "" ? null : id);
                }}
            />
            <div className="grid grid-cols-2 gap-2">
                <TextField
                    label={strings.pos.receiptEmail}
                    type="email"
                    value={cart.receiptEmail}
                    onChange={cart.setReceiptEmail}
                />
                <TextField
                    label={strings.pos.receiptPhone}
                    type="tel"
                    value={cart.receiptPhone}
                    onChange={cart.setReceiptPhone}
                />
            </div>
            <p className="text-xs text-muted">{strings.pos.receiptHint}</p>
        </div>
    );
}

function CardPayment({ cart }: { cart: ReturnType<typeof useCart> }) {
    const cards = useSavedCards(cart.clientId ?? "");
    const methods = checkoutMethods(cards);
    const sale = useSaleCheckout(api, cart, methods[0]?.id);
    if (cart.order === null) return null;
    return (
        <ChargeSheet
            checkout={sale.checkout}
            methods={methods}
            amountLabel={formatMoney(cart.order.total_cents)}
            submitLabel={strings.pos.payCard}
            busyLabel={strings.pos.paying}
            onSubmit={sale.submit}
            onCancel={cart.backToCart}
        />
    );
}

function CartPanel({ cart }: { cart: ReturnType<typeof useCart> }) {
    const canVoid = canVoidSale(useRole());
    if (cart.phase === "paid" && cart.order !== null) {
        return (
            <div className="rounded-lg border border-line bg-surface p-5 shadow-card">
                <h2 className="font-display text-base font-bold text-ink">
                    {strings.pos.paidTitle}
                </h2>
                <p className="mt-2 text-sm text-ink-soft">
                    {strings.pos.paidBody(formatMoney(cart.order.total_cents))}
                </p>
                <div className="mt-4">
                    <Button size="lg" full onPress={cart.newSale}>
                        {strings.pos.newSale}
                    </Button>
                </div>
            </div>
        );
    }
    return (
        <div className="flex max-h-[calc(100vh-4rem)] flex-col rounded-lg border border-line bg-surface shadow-card">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="font-display text-base font-bold text-ink">{strings.pos.cart}</h2>
                {cart.isEmpty ? null : (
                    <Button variant="quiet" size="sm" onPress={cart.clear}>
                        {strings.pos.clear}
                    </Button>
                )}
            </div>

            <SaleDetails cart={cart} />

            <div className="flex-1 overflow-y-auto px-4 py-2">
                {cart.isEmpty ? (
                    <p className="py-10 text-center text-sm text-muted">{strings.pos.cartEmpty}</p>
                ) : (
                    cart.lines.map((line) => (
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
                    ))
                )}
            </div>

            <div className="border-t border-line px-4 py-3">
                {cart.phase === "review" && cart.order !== null ? (
                    <>
                        <Totals order={cart.order} />
                        <div className="mt-3">
                            <CardPayment cart={cart} />
                        </div>
                        <div className="mt-3 flex gap-2">
                            {canVoid ? (
                                <Button
                                    variant="quiet"
                                    grow
                                    onPress={cart.voidSale}
                                    disabled={cart.busy}
                                >
                                    {strings.pos.voidSale}
                                </Button>
                            ) : null}
                            <Button variant="outline" grow onPress={cart.newSale}>
                                {strings.pos.newSale}
                            </Button>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="flex justify-between text-sm">
                            <span className="text-muted">{strings.pos.subtotal}</span>
                            <span className="font-medium tabular-nums text-ink">
                                {formatMoney(cart.subtotalCents)}
                                <span className="text-xs text-muted">{strings.pos.plusTax}</span>
                            </span>
                        </div>
                        <div className="mt-3">
                            <Button
                                size="lg"
                                full
                                onPress={cart.review}
                                busy={cart.busy}
                                disabled={cart.isEmpty}
                            >
                                {cart.busy ? strings.pos.totalling : strings.pos.reviewTotal}
                            </Button>
                        </div>
                    </>
                )}
                {cart.error !== null ? <Notice tone="danger">{cart.error}</Notice> : null}
            </div>
        </div>
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
        <div className="flex items-center gap-2 border-b border-line-soft py-2 last:border-0">
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{line.description}</p>
                <p className="text-xs tabular-nums text-muted">
                    {strings.pos.unitEach(formatMoney(line.unitAmountCents))}
                </p>
            </div>
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    onClick={() => {
                        onQuantity(line.quantity - 1);
                    }}
                    className="h-6 w-6 rounded-base border border-line text-sm text-ink-soft transition hover:bg-bg"
                    aria-label={strings.pos.decreaseQty}
                >
                    −
                </button>
                <span className="w-6 text-center text-sm tabular-nums text-ink">
                    {line.quantity}
                </span>
                <button
                    type="button"
                    onClick={() => {
                        onQuantity(line.quantity + 1);
                    }}
                    className="h-6 w-6 rounded-base border border-line text-sm text-ink-soft transition hover:bg-bg"
                    aria-label={strings.pos.increaseQty}
                >
                    +
                </button>
            </div>
            <span className="w-16 text-right text-sm font-medium tabular-nums text-ink">
                {formatMoney(line.unitAmountCents * line.quantity)}
            </span>
            <button
                type="button"
                onClick={onRemove}
                className="text-muted transition hover:text-danger"
                aria-label={strings.pos.removeLine}
            >
                ×
            </button>
        </div>
    );
}

function Totals({ order }: { order: Order }) {
    return (
        <div className="space-y-1 text-sm">
            <Row label={strings.pos.subtotal} cents={order.subtotal_cents} />
            <Row label={strings.pos.tax} cents={order.tax_total_cents} />
            <div className="flex justify-between border-t border-line-soft pt-1 font-semibold">
                <span className="text-ink">{strings.pos.total}</span>
                <span className="tabular-nums text-ink">{formatMoney(order.total_cents)}</span>
            </div>
        </div>
    );
}

function Row({ label, cents }: { label: string; cents: number }) {
    return (
        <div className="flex justify-between">
            <span className="text-muted">{label}</span>
            <span className="tabular-nums text-ink-soft">{formatMoney(cents)}</span>
        </div>
    );
}

function OnlineOrders() {
    const orders = useOnlineOrders();
    const pickup = usePickupAction(api);
    if (orders.length === 0) return null;

    return (
        <section className="mt-8">
            <h2 className="font-display text-base font-semibold text-ink">
                {strings.pos.onlineOrders}
            </h2>
            <div className="mt-2 divide-y divide-line-soft rounded-lg border border-line bg-surface">
                {orders.map((order) => (
                    <div key={order.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-ink">
                                {order.client_name ?? strings.pos.walkIn}
                            </p>
                            {order.summary !== null ? (
                                <p className="truncate text-xs text-muted">{order.summary}</p>
                            ) : null}
                        </div>
                        <StatusPill
                            status={PICKUP_LABEL[order.pickup_status]}
                            intent={pickupIntent(order.pickup_status)}
                            asWritten
                        />
                        <span className="font-medium tabular-nums text-ink">
                            {formatMoneyWithCurrency(order.total_cents, order.currency)}
                        </span>
                        {pickupActions(order.pickup_status).map((step) => (
                            <Button
                                key={step.status}
                                variant="outline"
                                size="sm"
                                disabled={pickup.busy}
                                onPress={() => {
                                    pickup.advance(order.id, step.status);
                                }}
                            >
                                {step.label}
                            </Button>
                        ))}
                    </div>
                ))}
            </div>
            {pickup.error !== null ? <Notice tone="danger">{pickup.error}</Notice> : null}
        </section>
    );
}

function OpenOrders() {
    const orders = useOpenOrders();
    if (orders.length === 0) return null;

    return (
        <section className="mt-8">
            <h2 className="font-display text-base font-semibold text-ink">
                {strings.pos.openOrders}
            </h2>
            <div className="mt-2 divide-y divide-line-soft rounded-lg border border-line bg-surface">
                {orders.map((order: OpenOrderRow) => (
                    <div key={order.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <span className="min-w-0 flex-1 truncate text-ink">
                            {order.client_name ?? strings.pos.walkIn}
                        </span>
                        <StatusPill
                            status={order.status}
                            intent={orderStatusIntent(order.status)}
                        />
                        <span className="font-medium tabular-nums text-ink">
                            {formatMoney(order.total_cents)}
                        </span>
                    </div>
                ))}
            </div>
        </section>
    );
}
