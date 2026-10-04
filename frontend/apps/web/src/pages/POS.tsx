import {
    type EntitlementKind,
    canVoidSale,
    type CartLine,
    checkoutMethods,
    entitlementKindsOnSale,
    useClients,
    useSaleCheckout,
    useSavedCards,
    useStripeAccountId,
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
import { ChargeSheet, ItemImage, StatusPill } from "@clientbridge/ui";
import { useMemo, useState } from "react";

import {
    ClientSelect,
    SellGiftCard,
    SellPackage,
    StartSubscription,
} from "../components/EntitlementSales";
import { IconSearch } from "../components/icons";
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

                <div className="relative mt-5">
                    <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input
                        value={q}
                        onChange={(e) => {
                            setQ(e.target.value);
                        }}
                        placeholder={strings.pos.searchPlaceholder}
                        className="w-full rounded-md border border-line bg-surface py-2.5 pl-9 pr-3 text-sm outline-hidden placeholder:text-muted focus:border-accent"
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
                        <div className="mt-2 flex flex-wrap gap-2">
                            {entitlements.map((kind) => (
                                <button
                                    key={kind}
                                    type="button"
                                    onClick={() => {
                                        setSelling(selling === kind ? null : kind);
                                    }}
                                    className={`rounded-md border px-3.5 py-2 text-sm font-semibold transition ${
                                        selling === kind
                                            ? "border-accent bg-accent-weak text-accent-strong"
                                            : "border-line text-ink-soft hover:bg-bg"
                                    }`}
                                >
                                    {ENTITLEMENT_LABEL[kind]}
                                </button>
                            ))}
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

const input =
    "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-hidden placeholder:text-muted focus:border-accent";

function SaleDetails({ cart }: { cart: ReturnType<typeof useCart> }) {
    const clients = useClients();
    return (
        <div className="space-y-2 border-b border-line px-4 py-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
                {strings.pos.clientLabel}
                <ClientSelect
                    clients={clients}
                    value={cart.clientId ?? ""}
                    onChange={(id) => {
                        cart.setClientId(id === "" ? null : id);
                    }}
                />
            </label>
            <div className="flex gap-2">
                <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-ink-soft">
                    {strings.pos.receiptEmail}
                    <input
                        value={cart.receiptEmail}
                        onChange={(e) => {
                            cart.setReceiptEmail(e.target.value);
                        }}
                        inputMode="email"
                        className={input}
                    />
                </label>
                <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-ink-soft">
                    {strings.pos.receiptPhone}
                    <input
                        value={cart.receiptPhone}
                        onChange={(e) => {
                            cart.setReceiptPhone(e.target.value);
                        }}
                        inputMode="tel"
                        className={input}
                    />
                </label>
            </div>
            <p className="text-xs text-muted">{strings.pos.receiptHint}</p>
        </div>
    );
}

function CardPayment({ cart }: { cart: ReturnType<typeof useCart> }) {
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
                <button
                    type="button"
                    onClick={cart.newSale}
                    className="mt-4 w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:opacity-90"
                >
                    {strings.pos.newSale}
                </button>
            </div>
        );
    }
    return (
        <div className="flex max-h-[calc(100vh-4rem)] flex-col rounded-lg border border-line bg-surface shadow-card">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="font-display text-base font-bold text-ink">{strings.pos.cart}</h2>
                {cart.isEmpty ? null : (
                    <button
                        type="button"
                        onClick={cart.clear}
                        className="text-xs font-medium text-muted transition hover:text-danger"
                    >
                        {strings.pos.clear}
                    </button>
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
                                <button
                                    type="button"
                                    onClick={cart.voidSale}
                                    disabled={cart.busy}
                                    className="flex-1 rounded-md px-3 py-2 text-sm font-medium text-muted transition hover:text-danger disabled:opacity-60"
                                >
                                    {strings.pos.voidSale}
                                </button>
                            ) : null}
                            <button
                                type="button"
                                onClick={cart.newSale}
                                className="flex-1 rounded-md border border-line px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-bg"
                            >
                                {strings.pos.newSale}
                            </button>
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
                        <button
                            type="button"
                            onClick={cart.review}
                            disabled={cart.busy || cart.isEmpty}
                            className="mt-3 w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                        >
                            {cart.busy ? strings.pos.totalling : strings.pos.reviewTotal}
                        </button>
                    </>
                )}
                {cart.error !== null ? (
                    <p className="mt-2 text-sm text-danger">{cart.error}</p>
                ) : null}
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
                            <button
                                key={step.status}
                                type="button"
                                disabled={pickup.busy}
                                onClick={() => {
                                    pickup.advance(order.id, step.status);
                                }}
                                className="rounded-md border border-line px-2.5 py-1 text-xs font-semibold text-ink-soft hover:bg-bg disabled:opacity-50"
                            >
                                {step.label}
                            </button>
                        ))}
                    </div>
                ))}
            </div>
            {pickup.error !== null ? (
                <p className="mt-2 text-sm text-danger-fg">{pickup.error}</p>
            ) : null}
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
