import {
    type ShopFlow,
    createPublicShopClient,
    money,
    strings,
    useShopFlow,
} from "@clientbridge/app-core/public";
import {
    Button,
    CardForm,
    Choice,
    Empty,
    ItemTile,
    LineItem,
    Modal,
    Notice,
    ProgressSteps,
    TextField,
} from "@clientbridge/ui";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { PublicPage } from "../components/PublicPage";
import { PublicStatus } from "../components/PublicStatus";
import { config } from "../config";
import { useEmbedSuccess } from "../embed";

const shopClient = createPublicShopClient(config.apiUrl);
const s = strings.publicShop;

/** The studio's online shop: browse by category, build an order, pay, pick up at the front desk. */
export function PublicShop() {
    const { slug = "" } = useParams<{ slug: string }>();
    const navigate = useNavigate();
    const shop = useShopFlow(shopClient, slug);
    const [cartOpen, setCartOpen] = useState(false);
    const page = shop.shop;
    useEmbedSuccess(shop.status === "paid", "shop");

    if (shop.status === "loading") return <PublicStatus kind="loading" />;
    if (shop.status === "not-found")
        return <PublicStatus kind="notFound" title={s.notFoundTitle} body={s.notFoundBody} />;
    if (shop.status === "error" || page === null)
        return <PublicStatus kind="error" title={s.loadErrorTitle} />;

    const bookVisit = (): void => {
        const done = navigate(`/book/${encodeURIComponent(slug)}`);
        if (done) done.catch(() => undefined);
    };
    const currency = page.items[0]?.currency ?? "CAD";
    const subtotal = money(shop.subtotalCents, currency);

    if (shop.status === "paying" || shop.status === "paid") {
        return (
            <PublicPage
                name={page.business_name}
                brand={page.brand}
                subtitle={s.subtitle}
                width="narrow"
            >
                <div className="rounded-xl border border-line bg-surface p-6 shadow-card">
                    {shop.status === "paying" ? <ShopPay shop={shop} /> : <ShopDone shop={shop} />}
                </div>
            </PublicPage>
        );
    }

    const checkout = (
        <div className="space-y-4">
            <CartLines shop={shop} />
            {shop.lines.length > 0 ? (
                <>
                    <dl className="space-y-1.5 border-t border-line pt-3 text-sm">
                        <div className="flex justify-between gap-3">
                            <dt className="text-ink-soft">{s.subtotal}</dt>
                            <dd className="font-semibold tabular-nums text-ink">{subtotal}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                            <dt className="text-muted">{s.tax}</dt>
                            <dd className="text-muted">{s.taxLater}</dd>
                        </div>
                    </dl>
                    <div className="rounded-lg border border-line bg-bg p-3 text-sm">
                        <p className="font-semibold text-ink">{s.pickupTitle}</p>
                        <p className="mt-1 text-xs text-muted">{s.pickupWhen}</p>
                    </div>
                    <div className="space-y-3">
                        <TextField
                            label={s.name}
                            value={shop.name}
                            onChange={shop.setName}
                            autoComplete="name"
                        />
                        <div className="grid gap-3 sm:grid-cols-2">
                            <TextField
                                label={s.phone}
                                type="tel"
                                value={shop.phone}
                                onChange={shop.setPhone}
                                autoComplete="tel"
                            />
                            <TextField
                                label={s.email}
                                type="email"
                                value={shop.email}
                                onChange={shop.setEmail}
                                autoComplete="email"
                                optional
                            />
                        </div>
                        <p className="text-xs text-muted">{s.reach}</p>
                    </div>
                    {page.stripe_account_id === null ? (
                        <Notice tone="info" banner>
                            {s.notTakingPayments}
                        </Notice>
                    ) : null}
                    {shop.error !== null ? <Notice tone="danger">{shop.error}</Notice> : null}
                    <Button
                        size="lg"
                        full
                        onPress={shop.submit}
                        busy={shop.busy}
                        disabled={!shop.canOrder || page.stripe_account_id === null}
                    >
                        {shop.busy ? s.placing : s.continuePay}
                    </Button>
                </>
            ) : null}
        </div>
    );

    return (
        <PublicPage
            name={page.business_name}
            brand={page.brand}
            subtitle={s.subtitle}
            actions={
                <Button size="sm" variant="outline" icon="calendar" onPress={bookVisit}>
                    {s.bookVisit}
                </Button>
            }
        >
            <div className="grid gap-8 pb-20 lg:grid-cols-[minmax(0,1fr)_340px] lg:pb-0">
                <section className="min-w-0">
                    <h1 className="font-display text-2xl font-bold text-ink">{s.title}</h1>
                    {page.items.length === 0 ? (
                        <div className="mt-5">
                            <Empty
                                variant="card"
                                icon="bag"
                                message={s.emptyTitle}
                                body={s.emptyBody}
                                actions={
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        icon="calendar"
                                        onPress={bookVisit}
                                    >
                                        {s.bookVisit}
                                    </Button>
                                }
                            />
                        </div>
                    ) : (
                        <>
                            {shop.categories.length > 2 ? (
                                <div className="mt-4 overflow-x-auto">
                                    <Choice
                                        label={s.categories}
                                        options={shop.categories}
                                        value={shop.category}
                                        onChange={shop.setCategory}
                                    />
                                </div>
                            ) : null}
                            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                                {shop.visible.map((i) => (
                                    <ItemTile
                                        key={i.id}
                                        variant="card"
                                        name={i.name}
                                        imageSrc={i.image_url}
                                        color={null}
                                        cents={i.price_cents}
                                        meta={i.description ?? undefined}
                                        count={shop.cart[i.id] ?? 0}
                                        disabled={!i.in_stock}
                                        tag={
                                            !i.in_stock
                                                ? { label: s.soldOut, intent: "neutral" }
                                                : i.stock_left !== null && i.stock_left <= 4
                                                  ? {
                                                        label: s.lowStock(i.stock_left),
                                                        intent: "warning",
                                                    }
                                                  : null
                                        }
                                        onPress={() => {
                                            shop.addOne(i);
                                        }}
                                    />
                                ))}
                            </div>
                        </>
                    )}
                </section>
                <aside className="hidden lg:block">
                    <div className="sticky top-6 rounded-xl border border-line bg-surface p-5 shadow-card">
                        <div className="mb-3 flex items-baseline justify-between">
                            <h2 className="font-display text-lg font-bold text-ink">{s.cart}</h2>
                            <span className="text-sm text-muted">{s.items(shop.count)}</span>
                        </div>
                        {checkout}
                    </div>
                </aside>
            </div>

            {shop.count > 0 ? (
                <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface px-4 py-3 lg:hidden">
                    <Button
                        full
                        size="lg"
                        onPress={() => {
                            setCartOpen(true);
                        }}
                    >
                        {`${s.viewOrder} · ${s.items(shop.count)} · ${subtotal}`}
                    </Button>
                </div>
            ) : null}
            <Modal
                open={cartOpen}
                size="xl"
                onClose={() => {
                    setCartOpen(false);
                }}
            >
                <h2 className="mb-3 font-display text-lg font-bold text-ink">{s.cart}</h2>
                {checkout}
            </Modal>
        </PublicPage>
    );
}

function CartLines({ shop }: { shop: ShopFlow }) {
    if (shop.lines.length === 0) return <Empty icon="bag" message={s.cartEmpty} />;
    return (
        <div className="divide-y divide-line-soft">
            {shop.lines.map((l) => (
                <LineItem
                    key={l.item.id}
                    title={l.item.name}
                    cents={l.item.price_cents * l.quantity}
                    quantity={{
                        value: l.quantity,
                        max: l.max,
                        onChange: (n) => {
                            shop.setLine(l.item, n);
                        },
                        label: l.item.name,
                    }}
                    onRemove={() => {
                        shop.setLine(l.item, 0);
                    }}
                    removeLabel={s.remove}
                />
            ))}
        </div>
    );
}

function ShopPay({ shop }: { shop: ShopFlow }) {
    const o = shop.order;
    if (o === null) return null;
    const total = money(o.total_cents, o.currency);
    return (
        <div className="space-y-4">
            <div>
                <h2 className="font-display text-xl font-bold text-ink">{s.payTitle}</h2>
                <p className="mt-1 text-sm text-muted">{s.payBody(total)}</p>
            </div>
            <CardForm
                clientSecret={o.client_secret}
                stripeAccount={o.stripe_account_id}
                submitLabel={s.pay(total)}
                busyLabel={s.paying}
                onDone={shop.markPaid}
                onCancel={shop.cancelPayment}
            />
        </div>
    );
}

function ShopDone({ shop }: { shop: ShopFlow }) {
    return (
        <div className="text-center">
            <h1 className="font-display text-2xl font-bold text-ink">{s.doneTitle}</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
                {s.doneBody(shop.orderNumber ?? "")}
            </p>
            <div className="mx-auto mt-6 max-w-xs text-left">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
                    {s.whatNext}
                </p>
                <ProgressSteps
                    layout="column"
                    label={s.whatNext}
                    steps={[
                        { key: "pack", label: s.nextPrepare, state: "current" },
                        { key: "text", label: s.nextText, state: "todo" },
                        { key: "pickup", label: s.nextPickup, state: "todo" },
                    ]}
                />
            </div>
        </div>
    );
}
