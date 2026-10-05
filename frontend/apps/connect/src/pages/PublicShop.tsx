import {
    type PublicShopItem,
    createPublicShopClient,
    formatMoneyWithCurrency,
    strings,
    usePublicShop,
} from "@clientbridge/app-core/public";
import { CardForm, field, ItemImage, primaryButtonLarge } from "@clientbridge/ui";
import type { SubmitEvent } from "react";
import { useParams } from "react-router-dom";

import { PublicCentered, PublicFrame } from "../components/PublicFrame";
import { useEmbedSuccess } from "../embed";
import { config } from "../config";

const shopClient = createPublicShopClient(config.apiUrl);

export function PublicShop() {
    const { slug = "" } = useParams<{ slug: string }>();
    const form = usePublicShop(shopClient, slug);
    const shop = form.shop;
    useEmbedSuccess(form.status === "paid", "shop");

    if (form.status === "loading")
        return (
            <PublicFrame>{<PublicCentered>{strings.common.loading}</PublicCentered>}</PublicFrame>
        );

    if (form.status === "not-found")
        return (
            <PublicFrame>
                <h1 className="font-display text-xl font-bold text-ink">
                    {strings.publicShop.notFoundTitle}
                </h1>
                <p className="mt-2 text-sm text-muted">{strings.publicShop.notFoundBody}</p>
            </PublicFrame>
        );

    if (form.status === "error" || shop === null)
        return (
            <PublicFrame>
                <h1 className="font-display text-xl font-bold text-ink">
                    {strings.common.somethingWrong}
                </h1>
                <p className="mt-2 text-sm text-muted">{strings.common.tryAgainLater}</p>
            </PublicFrame>
        );

    if (form.status === "paid")
        return (
            <PublicFrame brand={shop.brand}>
                <div className="py-4 text-center">
                    <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ok-bg text-2xl text-ok-fg">
                        ✓
                    </span>
                    <h1 className="mt-4 font-display text-xl font-bold text-ink">
                        {strings.publicShop.paidTitle}
                    </h1>
                    <p className="mt-2 text-sm text-muted">
                        {strings.publicShop.paidBody(shop.business_name)}
                    </p>
                </div>
            </PublicFrame>
        );

    if (form.status === "paying" && form.order !== null) {
        const total = formatMoneyWithCurrency(form.order.total_cents, form.order.currency);
        return (
            <PublicFrame brand={shop.brand}>
                <h1 className="font-display text-xl font-bold text-ink">
                    {strings.publicShop.payTitle}
                </h1>
                <p className="mt-2 text-sm text-muted">{strings.publicShop.total(total)}</p>
                <div className="mt-5">
                    <CardForm
                        clientSecret={form.order.client_secret}
                        stripeAccount={form.order.stripe_account_id}
                        submitLabel={strings.publicShop.payNow(total)}
                        busyLabel={strings.publicShop.paying}
                        onDone={form.markPaid}
                        onCancel={form.cancelPayment}
                    />
                </div>
            </PublicFrame>
        );
    }

    const submit = (e: SubmitEvent): void => {
        e.preventDefault();
        form.submit();
    };
    const currency = shop.items[0]?.currency ?? "CAD";

    return (
        <PublicFrame brand={shop.brand}>
            <h1 className="font-display text-xl font-bold text-ink">
                {strings.publicShop.title(shop.business_name)}
            </h1>
            <p className="mt-1 text-sm text-muted">{strings.publicShop.subtitle}</p>

            {shop.items.length === 0 ? (
                <p className="mt-6 text-sm text-muted">{strings.publicShop.empty}</p>
            ) : (
                <form onSubmit={submit} className="mt-6 space-y-6">
                    <ul className="grid gap-3 sm:grid-cols-2">
                        {shop.items.map((item) => (
                            <ShopCard
                                key={item.id}
                                item={item}
                                quantity={form.cart[item.id] ?? 0}
                                onQuantity={(q) => {
                                    form.setQuantity(item.id, q);
                                }}
                            />
                        ))}
                    </ul>

                    <section className="rounded-md border border-line p-4">
                        <h2 className="text-sm font-semibold text-ink">
                            {strings.publicShop.cart}
                        </h2>
                        {form.subtotalCents === 0 ? (
                            <p className="mt-2 text-sm text-muted">
                                {strings.publicShop.cartEmpty}
                            </p>
                        ) : (
                            <>
                                <p className="mt-2 flex justify-between text-sm text-ink">
                                    <span>{strings.publicShop.subtotal}</span>
                                    <span className="tabular-nums">
                                        {formatMoneyWithCurrency(form.subtotalCents, currency)}
                                    </span>
                                </p>
                                <p className="mt-1 text-xs text-muted">
                                    {strings.publicShop.taxNote}
                                </p>
                            </>
                        )}
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-sm font-semibold text-ink">
                            {strings.publicShop.yourDetails}
                        </h2>
                        <input
                            aria-label={strings.publicShop.name}
                            placeholder={strings.publicShop.name}
                            value={form.name}
                            onChange={(e) => {
                                form.setName(e.target.value);
                            }}
                            className={field}
                        />
                        <input
                            aria-label={strings.publicShop.email}
                            placeholder={strings.publicShop.email}
                            inputMode="email"
                            value={form.email}
                            onChange={(e) => {
                                form.setEmail(e.target.value);
                            }}
                            className={field}
                        />
                        <input
                            aria-label={strings.publicShop.phone}
                            placeholder={strings.publicShop.phone}
                            inputMode="tel"
                            value={form.phone}
                            onChange={(e) => {
                                form.setPhone(e.target.value);
                            }}
                            className={field}
                        />
                        <p className="text-xs text-muted">{strings.publicShop.reachYouNote}</p>
                    </section>

                    {shop.stripe_account_id === null ? (
                        <p className="rounded-md bg-accent-weak px-3 py-2 text-sm text-accent-strong">
                            {strings.publicShop.notTakingPayments}
                        </p>
                    ) : null}
                    {form.error !== null ? (
                        <p className="text-sm text-danger-fg">{form.error}</p>
                    ) : null}
                    <button
                        type="submit"
                        disabled={form.busy || shop.stripe_account_id === null}
                        className={`${primaryButtonLarge} w-full`}
                    >
                        {form.busy ? strings.publicShop.placing : strings.publicShop.placeOrder}
                    </button>
                </form>
            )}
        </PublicFrame>
    );
}

function ShopCard({
    item,
    quantity,
    onQuantity,
}: {
    item: PublicShopItem;
    quantity: number;
    onQuantity: (quantity: number) => void;
}) {
    const step =
        "flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink-soft hover:bg-bg";
    return (
        <li className="flex gap-3 rounded-md border border-line p-3">
            <ItemImage src={item.image_url} name={item.name} size={56} />
            <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-ink">{item.name}</span>
                <span className="text-sm tabular-nums text-muted">
                    {formatMoneyWithCurrency(item.price_cents, item.currency)}
                </span>
                <div className="mt-2">
                    {!item.in_stock ? (
                        <span className="text-xs font-medium text-muted">
                            {strings.publicShop.outOfStock}
                        </span>
                    ) : quantity === 0 ? (
                        <button
                            type="button"
                            onClick={() => {
                                onQuantity(1);
                            }}
                            className="rounded-md border border-line px-3 py-1 text-sm font-medium text-ink-soft hover:bg-bg"
                        >
                            {strings.publicShop.add}
                        </button>
                    ) : (
                        <span className="flex items-center gap-2">
                            <button
                                type="button"
                                aria-label="-"
                                onClick={() => {
                                    onQuantity(quantity - 1);
                                }}
                                className={step}
                            >
                                −
                            </button>
                            <span className="w-6 text-center text-sm tabular-nums">{quantity}</span>
                            <button
                                type="button"
                                aria-label="+"
                                onClick={() => {
                                    onQuantity(quantity + 1);
                                }}
                                className={step}
                            >
                                +
                            </button>
                        </span>
                    )}
                </div>
            </div>
        </li>
    );
}
