import {
    type PublicShopItem,
    createPublicShopClient,
    formatMoneyWithCurrency,
    strings,
    usePublicShop,
} from "@clientbridge/app-core/public";
import { Button, CardForm, Empty, ItemImage, Notice, Stepper, TextField } from "@clientbridge/ui";
import type { SubmitEvent } from "react";
import { useParams } from "react-router-dom";

import { PublicFrame } from "../components/PublicFrame";
import { PublicDone, PublicStatus } from "../components/PublicStatus";
import { useEmbedSuccess } from "../embed";
import { config } from "../config";

const shopClient = createPublicShopClient(config.apiUrl);

export function PublicShop() {
    const { slug = "" } = useParams<{ slug: string }>();
    const form = usePublicShop(shopClient, slug);
    const shop = form.shop;
    useEmbedSuccess(form.status === "paid", "shop");

    if (form.status === "loading") return <PublicStatus kind="loading" />;

    if (form.status === "not-found")
        return (
            <PublicStatus
                kind="notFound"
                title={strings.publicShop.notFoundTitle}
                body={strings.publicShop.notFoundBody}
            />
        );

    if (form.status === "error" || shop === null) return <PublicStatus kind="error" />;

    if (form.status === "paid")
        return (
            <PublicDone
                brand={shop.brand}
                title={strings.publicShop.paidTitle}
                body={strings.publicShop.paidBody(shop.business_name)}
            />
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
                <Empty message={strings.publicShop.empty} />
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
                        <TextField
                            placeholder={strings.publicShop.name}
                            value={form.name}
                            onChange={form.setName}
                            autoComplete="name"
                        />
                        <TextField
                            placeholder={strings.publicShop.email}
                            type="email"
                            value={form.email}
                            onChange={form.setEmail}
                            autoComplete="email"
                        />
                        <TextField
                            placeholder={strings.publicShop.phone}
                            type="tel"
                            value={form.phone}
                            onChange={form.setPhone}
                            autoComplete="tel"
                        />
                        <p className="text-xs text-muted">{strings.publicShop.reachYouNote}</p>
                    </section>

                    {shop.stripe_account_id === null ? (
                        <Notice tone="info" banner>
                            {strings.publicShop.notTakingPayments}
                        </Notice>
                    ) : null}
                    {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                    <Button
                        submit
                        size="lg"
                        full
                        busy={form.busy}
                        disabled={shop.stripe_account_id === null}
                    >
                        {form.busy ? strings.publicShop.placing : strings.publicShop.placeOrder}
                    </Button>
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
                        <Button
                            variant="outline"
                            size="sm"
                            onPress={() => {
                                onQuantity(1);
                            }}
                        >
                            {strings.publicShop.add}
                        </Button>
                    ) : (
                        <Stepper
                            value={quantity}
                            onChange={onQuantity}
                            min={0}
                            label={strings.publicShop.quantity}
                        />
                    )}
                </div>
            </div>
        </li>
    );
}
