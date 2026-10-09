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
    ItemImage,
    SearchField,
    LineItem,
    Modal,
    Notice,
    ProgressSteps,
    TextField,
    Toggle,
    Icon,
} from "@clientbridge/ui";
import { type ReactNode, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PublicPage } from "../components/PublicPage";
import { PublicStatus } from "../components/PublicStatus";
import { config } from "../config";
import { isEmbedded, useEmbedSuccess } from "../embed";

const shopClient = createPublicShopClient(config.apiUrl);
const s = strings.publicShop;
const cartStorage = (() => {
    try {
        return window.sessionStorage;
    } catch {
        return undefined;
    }
})();

export function PublicShop() {
    const { slug = "" } = useParams<{ slug: string }>();
    return <ShopPage key={slug} slug={slug} />;
}

function ShopPage({ slug }: { slug: string }) {
    const navigate = useNavigate();
    const checkoutRoute = useLocation().pathname.endsWith("/checkout");
    const shop = useShopFlow(shopClient, slug, cartStorage);
    const [params, setParams] = useSearchParams();
    const cartOpen = params.get("cart") === "1";
    const setCartOpen = (open: boolean) => {
        setParams(
            (previous) => {
                const next = new URLSearchParams(previous);
                if (open) {
                    next.set("cart", "1");
                    next.delete("product");
                } else next.delete("cart");
                return next;
            },
            { replace: true },
        );
    };
    const [summaryOpen, setSummaryOpen] = useState(false);
    const [variantId, setVariantId] = useState("");
    const productId = params.get("product");
    const setProductId = (id: string | null) => {
        setParams(
            (previous) => {
                const next = new URLSearchParams(previous);
                if (id) next.set("product", id);
                else next.delete("product");
                return next;
            },
            { replace: true },
        );
    };
    const page = shop.shop;
    useEmbedSuccess(shop.status === "paid", "shop");
    if (shop.status === "loading") return <PublicStatus kind="loading" />;
    if (shop.status === "not-found")
        return <PublicStatus kind="notFound" title={s.notFoundTitle} body={s.notFoundBody} />;
    if (shop.status === "error" || page === null)
        return <PublicStatus kind="error" title={s.loadErrorTitle} />;
    const go = (path: string): void => {
        const result = navigate(
            isEmbedded() ? `${path}${path.includes("?") ? "&" : "?"}embed=1` : path,
        );
        if (result) result.catch(() => undefined);
    };
    const currency = page.items[0]?.currency ?? "CAD";
    const subtotal = money(shop.subtotalCents, currency);
    const checkingOut = checkoutRoute || shop.status === "paying" || shop.status === "paid";
    const product = page.items.find((item) => item.id === productId) ?? null;
    const variants = product ? shop.variants(product.id) : [];
    const chosen = variants.length
        ? (variants.find((variant) => variant.id === variantId) ?? null)
        : product;
    const summary = <OrderSummary shop={shop} />;
    const hero = (
        <div>
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
                {checkingOut ? (shop.status === "paid" ? s.doneTitle : s.checkout) : s.title}
            </h1>
            <p className="mt-2 text-sm text-muted">{checkingOut ? s.checkoutBody : s.subtitle}</p>
        </div>
    );
    return (
        <PublicPage
            name={page.business_name}
            brand={page.brand}
            hero={hero}
            cartCount={shop.count}
            actions={
                checkingOut ? (
                    <Button
                        size="sm"
                        variant="outline"
                        icon="chevronLeft"
                        onPress={() => {
                            go(`/b/${encodeURIComponent(slug)}/shop`);
                        }}
                    >
                        {s.backToShop}
                    </Button>
                ) : undefined
            }
        >
            {shop.status === "paid" ? (
                <div className="mx-auto max-w-3xl rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
                    <ShopDone shop={shop} />
                </div>
            ) : checkingOut ? (
                <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
                    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card lg:hidden">
                        <Button
                            full
                            variant="quiet"
                            icon={summaryOpen ? "chevronUp" : "chevronDown"}
                            onPress={() => {
                                setSummaryOpen(!summaryOpen);
                            }}
                        >
                            {summaryOpen ? s.hideSummary : s.showSummary(subtotal)}
                        </Button>
                        {summaryOpen ? <div className="p-5">{summary}</div> : null}
                    </div>
                    <div className="divide-y divide-line-soft overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
                        {shop.lines.length === 0 && shop.order === null ? (
                            <div className="p-6">
                                <Empty icon="bag" message={s.cartEmpty} />
                            </div>
                        ) : (
                            <>
                                <CheckoutSection n={1} title={s.sectionPickup}>
                                    <div className="space-y-4">
                                        <Choice
                                            label={s.pickupDay}
                                            layout="tiles"
                                            columns={4}
                                            value={shop.pickupDay}
                                            onChange={shop.setPickupDay}
                                            options={shop.pickupDays.map((day) => ({
                                                ...day,
                                                disabled: shop.status === "paying",
                                            }))}
                                            className="max-sm:grid-cols-2"
                                        />
                                        {shop.pickupWindows.length ? (
                                            <Choice
                                                label={s.pickupWindow}
                                                layout="tiles"
                                                columns={3}
                                                value={shop.pickupFrom}
                                                onChange={shop.setPickupFrom}
                                                options={shop.pickupWindows.map((window) => ({
                                                    ...window,
                                                    disabled: shop.status === "paying",
                                                }))}
                                            />
                                        ) : (
                                            <p className="text-sm text-muted">{s.pickupWhen}</p>
                                        )}
                                        {shop.pickup ? (
                                            <p className="text-xs text-muted">
                                                {s.pickupHold(shop.pickup.hold_days)}
                                            </p>
                                        ) : null}
                                        <TextField
                                            label={s.pickupNote}
                                            value={shop.note}
                                            onChange={shop.setNote}
                                            maxLength={1000}
                                            optional
                                            multiline
                                            disabled={shop.status === "paying"}
                                        />
                                    </div>
                                </CheckoutSection>
                                <CheckoutSection n={2} title={s.sectionDetails}>
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <div className="sm:col-span-2">
                                            <TextField
                                                label={s.name}
                                                value={shop.name}
                                                onChange={shop.setName}
                                                autoComplete="name"
                                                disabled={shop.status === "paying"}
                                            />
                                        </div>
                                        <TextField
                                            label={s.phone}
                                            type="tel"
                                            value={shop.phone}
                                            onChange={shop.setPhone}
                                            autoComplete="tel"
                                            disabled={shop.status === "paying"}
                                        />
                                        <TextField
                                            label={s.email}
                                            type="email"
                                            value={shop.email}
                                            onChange={shop.setEmail}
                                            autoComplete="email"
                                            optional
                                            disabled={shop.status === "paying"}
                                        />
                                        <p className="text-xs text-muted sm:col-span-2">
                                            {s.reach}
                                        </p>
                                        <div className="sm:col-span-2">
                                            <Toggle
                                                label={strings.publicOrder.alerts}
                                                value={shop.notifySms}
                                                onChange={shop.setNotifySms}
                                                disabled={shop.status === "paying"}
                                            />
                                        </div>
                                    </div>
                                </CheckoutSection>
                                <CheckoutSection n={3} title={s.sectionPay}>
                                    <div className="space-y-4">
                                        {shop.status === "paying" ? (
                                            <ShopPay shop={shop} />
                                        ) : (
                                            <>
                                                {page.stripe_account_id === null ? (
                                                    <Notice tone="info">
                                                        {s.notTakingPayments}
                                                    </Notice>
                                                ) : null}
                                                {shop.error ? (
                                                    <Notice tone="danger">{shop.error}</Notice>
                                                ) : null}
                                                <Button
                                                    size="lg"
                                                    full
                                                    icon="card"
                                                    onPress={shop.submit}
                                                    busy={shop.busy}
                                                    disabled={
                                                        !shop.canOrder ||
                                                        page.stripe_account_id === null
                                                    }
                                                >
                                                    {shop.busy ? s.placing : s.continuePay}
                                                </Button>
                                            </>
                                        )}
                                        <p className="flex items-start gap-2 text-xs text-muted">
                                            <Icon name="lock" size={14} />
                                            {strings.publicBooking.secure}
                                        </p>
                                    </div>
                                </CheckoutSection>
                            </>
                        )}
                    </div>
                    <aside className="hidden rounded-2xl border border-line bg-surface p-5 shadow-card lg:sticky lg:top-6 lg:block">
                        {summary}
                    </aside>
                </div>
            ) : (
                <>
                    <section className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-6">
                        <h2 className="sr-only">{s.title}</h2>
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                            <SearchField
                                placeholder={s.search}
                                value={shop.search}
                                onChange={shop.setSearch}
                                className="lg:w-80"
                            />
                            <div className="overflow-x-auto">
                                <Choice
                                    label={s.categories}
                                    options={shop.categories}
                                    value={shop.category}
                                    onChange={shop.setCategory}
                                />
                            </div>
                        </div>
                        {shop.visible.length === 0 ? (
                            <div className="py-10">
                                <Empty
                                    icon="bag"
                                    message={page.items.length ? s.noMatches : s.emptyTitle}
                                />
                            </div>
                        ) : (
                            <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
                                {shop.visible.map((item) => (
                                    <ItemTile
                                        key={item.id}
                                        variant="card"
                                        name={item.name}
                                        imageSrc={item.image_url}
                                        color={null}
                                        cents={item.price_cents}
                                        meta={item.category ?? undefined}
                                        count={shop.cart[item.id] ?? 0}
                                        tag={
                                            !item.in_stock
                                                ? { label: s.soldOut, intent: "neutral" }
                                                : item.stock_left !== null && item.stock_left <= 4
                                                  ? {
                                                        label: s.lowStock(item.stock_left),
                                                        intent: "warning",
                                                    }
                                                  : null
                                        }
                                        onPress={() => {
                                            setVariantId("");
                                            setProductId(item.id);
                                        }}
                                    />
                                ))}
                            </div>
                        )}
                    </section>
                    <div className="h-24" />
                    {shop.count > 0 ? (
                        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur sm:inset-x-auto sm:right-6 sm:bottom-6 sm:rounded-2xl sm:border sm:p-2 sm:shadow-pop">
                            <Button
                                full
                                size="lg"
                                icon="bag"
                                onPress={() => {
                                    setCartOpen(true);
                                }}
                            >{`${s.viewOrder} · ${s.items(shop.count)} · ${subtotal}`}</Button>
                        </div>
                    ) : null}
                </>
            )}
            <Modal
                open={cartOpen}
                size="lg"
                onClose={() => {
                    setCartOpen(false);
                }}
            >
                {summary}
                <div className="mt-6 flex flex-col gap-2">
                    {shop.count > 0 ? (
                        <Button
                            full
                            size="lg"
                            onPress={() => {
                                go(`/b/${encodeURIComponent(slug)}/shop/checkout`);
                            }}
                        >
                            {s.checkout}
                        </Button>
                    ) : null}
                    <Button
                        variant="quiet"
                        onPress={() => {
                            setCartOpen(false);
                        }}
                    >
                        {s.close}
                    </Button>
                </div>
            </Modal>
            <Modal
                open={product !== null}
                size="xl"
                onClose={() => {
                    setProductId(null);
                }}
            >
                {product ? (
                    <div className="grid gap-6 sm:grid-cols-2">
                        <div className="flex items-center justify-center rounded-xl bg-bg p-4">
                            <ItemImage src={product.image_url} name={product.name} size={260} />
                        </div>
                        <div className="space-y-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                                {product.category}
                            </p>
                            <h2 className="font-display text-2xl font-bold text-ink">
                                {product.name}
                            </h2>
                            {chosen ? (
                                <p className="font-mono text-xl font-semibold text-ink">
                                    {money(chosen.price_cents, chosen.currency)}
                                </p>
                            ) : null}
                            {product.description ? (
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
                                    {product.description}
                                </p>
                            ) : null}
                            {variants.length ? (
                                <Choice
                                    label={s.variant}
                                    layout="chips"
                                    value={variantId}
                                    onChange={setVariantId}
                                    options={variants.map((variant) => ({
                                        key: variant.id,
                                        label: variant.variant_label ?? variant.name,
                                        hint: money(variant.price_cents, variant.currency),
                                        disabled: !variant.in_stock,
                                    }))}
                                />
                            ) : null}
                            {chosen ? (
                                <p className="text-sm text-muted">
                                    {chosen.in_stock
                                        ? chosen.stock_left !== null && chosen.stock_left <= 4
                                            ? s.lowStock(chosen.stock_left)
                                            : s.inStock
                                        : s.soldOut}
                                </p>
                            ) : null}
                            <div className="rounded-xl bg-accent-weak p-4">
                                <p className="flex gap-2 text-sm font-semibold">
                                    <Icon name="pin" size={16} />
                                    {s.pickupTitle}
                                </p>
                                <p className="mt-1 text-xs text-muted">{s.pickupWhen}</p>
                            </div>
                            <div className="flex gap-3">
                                <Button
                                    variant="outline"
                                    onPress={() => {
                                        setProductId(null);
                                    }}
                                >
                                    {s.close}
                                </Button>
                                <Button
                                    grow
                                    disabled={!chosen?.in_stock}
                                    onPress={() => {
                                        if (!chosen) return;
                                        shop.addOne(chosen);
                                        setCartOpen(true);
                                    }}
                                >
                                    {s.addToOrder}
                                </Button>
                            </div>
                        </div>
                    </div>
                ) : null}
            </Modal>
        </PublicPage>
    );
}

function CheckoutSection({
    n,
    title,
    children,
}: {
    n: number;
    title: string;
    children: ReactNode;
}) {
    return (
        <section className="p-5 sm:p-7" aria-label={title}>
            <div className="mb-5 flex items-start gap-3">
                <span
                    aria-hidden
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-ink"
                >
                    {n}
                </span>
                <h2 className="font-display text-lg font-bold leading-7 text-ink">{title}</h2>
            </div>
            {children}
        </section>
    );
}

function OrderSummary({ shop }: { shop: ShopFlow }) {
    const currency = shop.shop?.items[0]?.currency ?? "CAD";
    return (
        <div className="space-y-4">
            <div className="flex items-baseline justify-between">
                <h2 className="font-display text-lg font-bold text-ink">{s.cart}</h2>
                <span className="text-sm text-muted">{s.items(shop.count)}</span>
            </div>
            <CartLines shop={shop} />
            <dl className="space-y-2 border-t border-line pt-3 text-sm">
                <div className="flex justify-between">
                    <dt>{s.subtotal}</dt>
                    <dd>{money(shop.order?.subtotal_cents ?? shop.subtotalCents, currency)}</dd>
                </div>
                <div className="flex justify-between text-muted">
                    <dt>{s.tax}</dt>
                    <dd>
                        {shop.order
                            ? shop.order.tax_total_cents !== null &&
                              shop.order.tax_total_cents !== undefined
                                ? money(shop.order.tax_total_cents, currency)
                                : s.taxLater
                            : s.taxLater}
                    </dd>
                </div>
                {shop.order ? (
                    <div className="flex justify-between font-bold">
                        <dt>{strings.publicOrder.total}</dt>
                        <dd>{money(shop.order.total_cents, currency)}</dd>
                    </div>
                ) : null}
            </dl>
            <p className="text-xs text-muted">{s.noTip}</p>
            <div className="rounded-xl bg-accent-weak p-3.5">
                <p className="flex items-center gap-2 text-sm font-semibold">
                    <Icon name="pin" size={18} />
                    {s.pickupTitle}
                </p>
                <p className="mt-1 text-xs text-muted">{s.pickupWhen}</p>
            </div>
        </div>
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
                    quantity={
                        shop.order
                            ? undefined
                            : {
                                  value: l.quantity,
                                  max: l.max,
                                  onChange: (n) => {
                                      shop.setLine(l.item, n);
                                  },
                                  label: l.item.name,
                              }
                    }
                    onRemove={
                        shop.order
                            ? undefined
                            : () => {
                                  shop.setLine(l.item, 0);
                              }
                    }
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
            {shop.order?.order_token ? (
                <div className="mt-5">
                    <Button
                        onPress={() => {
                            window.location.assign(
                                `/order/${encodeURIComponent(shop.order?.order_token ?? "")}`,
                            );
                        }}
                    >
                        {strings.publicOrder.title}
                    </Button>
                </div>
            ) : null}
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
