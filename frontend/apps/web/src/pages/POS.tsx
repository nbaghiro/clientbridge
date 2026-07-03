import {
    type CartLine,
    type OpenOrderRow,
    type Order,
    filterItems,
    formatMoney,
    orderStatusIntent,
    sellableItems,
    strings,
    useCart,
    useCatalogItems,
    useConnectionToken,
    useOpenOrders,
    useSearch,
} from "@clientbridge/app-core";
import { useMemo } from "react";

import { IconSearch } from "../components/icons";
import { StatusPill } from "../components/StatusPill";
import { api } from "../lib/api";

export function POS() {
    const cart = useCart(api);
    const items = useCatalogItems();
    const active = useMemo(() => sellableItems(items), [items]);
    const { q, setQ, filtered } = useSearch(active, filterItems);

    return (
        <div className="mx-auto flex h-full max-w-6xl gap-6 px-8 py-8">
            <section className="min-w-0 flex-1">
                <h1 className="font-display text-2xl font-bold text-ink">{strings.pos.title}</h1>
                <p className="mt-0.5 text-sm text-muted">{strings.pos.subtitle}</p>

                <div className="relative mt-5">
                    <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input
                        value={q}
                        onChange={(e) => {
                            setQ(e.target.value);
                        }}
                        placeholder={strings.pos.searchPlaceholder}
                        className="w-full rounded-md border border-line bg-surface py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-muted focus:border-accent"
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
                            <span className="line-clamp-2 text-sm font-medium text-ink">
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

                <OpenOrders />
            </section>

            <aside className="w-80 shrink-0">
                <CartPanel cart={cart} />
            </aside>
        </div>
    );
}

function CartPanel({ cart }: { cart: ReturnType<typeof useCart> }) {
    if (cart.phase === "awaiting_reader" && cart.checkoutResult !== null && cart.order !== null) {
        return (
            <ReaderPanel
                order={cart.order}
                clientSecret={cart.checkoutResult.client_secret}
                onDone={cart.newSale}
                onVoid={cart.voidSale}
                busy={cart.busy}
            />
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
                        <button
                            type="button"
                            onClick={cart.charge}
                            disabled={cart.busy}
                            className="mt-3 w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                        >
                            {cart.busy
                                ? strings.pos.starting
                                : strings.pos.charge(formatMoney(cart.order.total_cents))}
                        </button>
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
                    className="h-6 w-6 rounded border border-line text-sm text-ink-soft transition hover:bg-bg"
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
                    className="h-6 w-6 rounded border border-line text-sm text-ink-soft transition hover:bg-bg"
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
        <div className="rounded-lg border border-line bg-surface p-5 shadow-card">
            <h2 className="font-display text-base font-bold text-ink">{strings.pos.readerTitle}</h2>
            <p className="mt-1 text-sm text-muted">
                {strings.pos.readerCollectLead}{" "}
                <span className="font-semibold text-ink">{formatMoney(order.total_cents)}</span>.
            </p>
            <div className="mt-4 rounded-md border border-dashed border-accent-line bg-accent-weak p-4 text-center">
                <p className="text-sm font-medium text-accent-strong">
                    {strings.pos.waitingForCard}
                </p>
                <p className="mt-1 text-xs text-muted">{strings.pos.readerNotWired}</p>
            </div>
            <p className="mt-3 truncate text-xs text-muted">
                {strings.pos.paymentIntentLabel} {clientSecret}
            </p>
            <div className="mt-4 flex gap-2">
                <button
                    type="button"
                    onClick={() => {
                        void tokenProvider();
                    }}
                    className="flex-1 rounded-md border border-line px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-bg"
                >
                    {strings.pos.pairReader}
                </button>
                <button
                    type="button"
                    onClick={onDone}
                    className="flex-1 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90"
                >
                    {strings.pos.newSale}
                </button>
            </div>
            <button
                type="button"
                onClick={onVoid}
                disabled={busy}
                className="mt-2 w-full rounded-md px-3 py-2 text-sm font-medium text-muted transition hover:text-danger disabled:opacity-60"
            >
                {strings.pos.voidSale}
            </button>
        </div>
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
