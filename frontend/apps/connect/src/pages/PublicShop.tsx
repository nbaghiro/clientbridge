import {
    type ShopFlow,
    createPublicShopClient,
    strings,
    useShopFlow,
    formatParts,
    formatMoney,
} from "@clientbridge/app-core/public";
import {
    Button,
    CardForm,
    Choice,
    DocTotals,
    Empty,
    ItemTile,
    ItemImage,
    SearchField,
    Select,
    LineItem,
    Notice,
    ProgressSteps,
    Stepper,
    TextField,
    Toggle,
    Icon,
} from "@clientbridge/ui";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { PublicPage } from "../components/PublicPage";
import { PublicStatus } from "../components/PublicStatus";
import {
    type StepAction,
    StepCard,
    StepLayout,
    SummaryBar,
    SummaryPanel,
} from "../components/StepLayout";
import { config } from "../config";
import { useSlug } from "../site";
import { isEmbedded, useEmbedSuccess } from "../embed";

const shopClient = createPublicShopClient(config.apiUrl);
const s = strings.publicShop;
const SUMMARY_ID = "order-summary";
const cartStorage = (() => {
    try {
        return window.sessionStorage;
    } catch {
        return undefined;
    }
})();

export function PublicShop() {
    const slug = useSlug();
    return <ShopPage key={slug} slug={slug} />;
}

function ShopPage({ slug }: { slug: string }) {
    const navigate = useNavigate();
    const checkoutRoute = useLocation().pathname.endsWith("/checkout");
    const shop = useShopFlow(shopClient, slug, cartStorage);
    const [params, setParams] = useSearchParams();
    const [barOpen, setBarOpen] = useState(false);
    const page = shop.shop;
    const ready = page !== null;
    const cartParam = params.get("cart") === "1";
    const productParam = params.get("product");
    useEmbedSuccess(shop.status === "paid", "shop");

    useEffect(() => {
        if (!ready || (!cartParam && productParam === null)) return;
        if (cartParam) {
            if (window.matchMedia("(min-width: 1024px)").matches)
                document.getElementById(SUMMARY_ID)?.focus();
            else setBarOpen(true);
        }
        if (productParam !== null) {
            const target = shop.shop?.items.find((item) => item.id === productParam);
            const productId = target?.variant_parent_id ?? productParam;
            if (target?.variant_parent_id) shop.setVariantId(productId, productParam);
            const card = document.getElementById(`product-${productId}`);
            card?.scrollIntoView({ block: "center" });
            card?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
        }
        setParams(
            (previous) => {
                const next = new URLSearchParams(previous);
                next.delete("cart");
                next.delete("product");
                return next;
            },
            { replace: true },
        );
    }, [ready, cartParam, productParam, shop, setParams]);

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
    const shopPath = `/${encodeURIComponent(slug)}`;
    const checkingOut = checkoutRoute || shop.status === "paying" || shop.status === "paid";
    const total = formatMoney(shop.order?.total_cents ?? shop.subtotalCents, shop.currency);
    const hero = (
        <div>
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
                {checkingOut ? (shop.status === "paid" ? s.doneTitle : s.checkout) : s.title}
            </h1>
            <p className="mt-2 text-sm text-muted">{checkingOut ? s.checkoutBody : s.subtitle}</p>
        </div>
    );
    const empty = shop.lines.length === 0 && shop.order === null;
    const next: StepAction | undefined = !checkingOut
        ? {
              label: s.checkout,
              onPress: () => {
                  go(`${shopPath}/checkout`);
              },
              disabled: shop.count === 0,
          }
        : empty || shop.step === "pay"
          ? undefined
          : shop.step === "pickup"
            ? { label: s.continue, onPress: shop.next }
            : {
                  label: shop.busy ? s.placing : s.continuePay,
                  onPress: shop.next,
                  busy: shop.busy,
                  disabled: page.stripe_account_id === null,
              };
    const back: StepAction | undefined =
        checkingOut && shop.step === "pickup"
            ? {
                  label: s.backToShop,
                  onPress: () => {
                      go(shopPath);
                  },
              }
            : checkingOut && shop.step === "details"
              ? { label: s.back, onPress: shop.back }
              : undefined;
    return (
        <PublicPage
            name={page.business_name}
            brand={page.brand}
            hero={hero}
            cartCount={shop.count}
            actions={
                checkingOut && shop.status !== "paid" ? (
                    <Button
                        size="sm"
                        variant="outline"
                        icon="chevronLeft"
                        onPress={() => {
                            go(shopPath);
                        }}
                    >
                        {s.backToShop}
                    </Button>
                ) : undefined
            }
        >
            <p aria-live="polite" className="sr-only">
                {shop.count > 0 ? s.orderUpdated(s.items(shop.count), total) : ""}
            </p>
            {shop.status === "paid" ? (
                <div className="mx-auto max-w-3xl rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
                    <ShopDone shop={shop} />
                </div>
            ) : (
                <StepLayout
                    summary={
                        <SummaryPanel title={s.cart} titleId={SUMMARY_ID} next={next} back={back}>
                            <OrderSummary shop={shop} />
                        </SummaryPanel>
                    }
                    bar={
                        next !== undefined && !empty ? (
                            <SummaryBar
                                label={s.items(shop.count)}
                                amount={
                                    <span className="shrink-0 font-mono font-semibold tabular-nums text-ink">
                                        {total}
                                    </span>
                                }
                                next={next}
                                panel={<OrderSummary shop={shop} />}
                                open={barOpen}
                                onToggle={setBarOpen}
                            />
                        ) : null
                    }
                >
                    {checkingOut ? (
                        empty ? (
                            <Empty
                                variant="card"
                                icon="bag"
                                message={s.cartEmpty}
                                actions={
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onPress={() => {
                                            go(shopPath);
                                        }}
                                    >
                                        {s.backToShop}
                                    </Button>
                                }
                            />
                        ) : (
                            <CheckoutSteps
                                shop={shop}
                                takingPayments={page.stripe_account_id !== null}
                            />
                        )
                    ) : (
                        <Catalog shop={shop} />
                    )}
                    {shop.error !== null ? (
                        <div className="mt-4">
                            <Notice tone="danger">{shop.error}</Notice>
                        </div>
                    ) : null}
                </StepLayout>
            )}
        </PublicPage>
    );
}

function Catalog({ shop }: { shop: ShopFlow }) {
    const items = shop.shop?.items ?? [];
    return (
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
            <h2 className="sr-only">{s.title}</h2>
            <div className="flex flex-col gap-3">
                <SearchField
                    placeholder={s.search}
                    value={shop.search}
                    onChange={shop.setSearch}
                    className="sm:w-80"
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
                    <Empty icon="bag" message={items.length ? s.noMatches : s.emptyTitle} />
                </div>
            ) : (
                <ul className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
                    {shop.visible.map((item) => (
                        <li key={item.id} id={`product-${item.id}`} className="flex">
                            <ItemTile
                                variant="card"
                                className="w-full"
                                name={item.name}
                                detail={item.description ?? undefined}
                                imageSrc={item.image_url}
                                color={null}
                                cents={item.price_cents}
                                currency={item.currency}
                                meta={item.category ?? undefined}
                                count={shop.inCart(item.id)}
                                disabled={!item.in_stock}
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
                                actions={<ProductActions shop={shop} productId={item.id} />}
                            />
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function ProductActions({ shop, productId }: { shop: ShopFlow; productId: string }) {
    const product = shop.shop?.items.find((item) => item.id === productId) ?? null;
    if (product === null) return null;
    const options = shop.variants(productId);
    const target = options.length
        ? (options.find((variant) => variant.id === shop.variantId(productId)) ?? null)
        : product;
    const quantity = target === null ? 0 : (shop.cart[target.id] ?? 0);
    return (
        <span className="flex flex-col gap-2">
            {options.length ? (
                <Select
                    name={s.variant}
                    size="sm"
                    value={shop.variantId(productId)}
                    onChange={(id) => {
                        shop.setVariantId(productId, id);
                    }}
                    options={options.map((variant) => ({
                        key: variant.id,
                        label: variant.variant_label ?? variant.name,
                        detail: formatMoney(variant.price_cents, variant.currency),
                        disabled: !variant.in_stock,
                    }))}
                />
            ) : null}
            {target !== null && quantity > 0 ? (
                <Stepper
                    className="w-full justify-between"
                    value={quantity}
                    min={0}
                    max={shop.maxOf(target)}
                    label={target.name}
                    onChange={(n) => {
                        shop.setLine(target, n);
                    }}
                />
            ) : (
                <Button
                    size="sm"
                    variant="outline"
                    icon="plus"
                    full
                    label={s.addNamed(target?.name ?? product.name)}
                    disabled={!target?.in_stock}
                    onPress={() => {
                        if (target !== null) shop.addOne(target);
                    }}
                >
                    {s.addToOrder}
                </Button>
            )}
        </span>
    );
}

function CheckoutSteps({ shop, takingPayments }: { shop: ShopFlow; takingPayments: boolean }) {
    const paying = shop.step === "pay";
    return (
        <div className="space-y-3">
            <StepCard
                n={1}
                title={s.sectionPickup}
                summary={shop.pickupLabel}
                state={shop.step === "pickup" ? "open" : "done"}
                editLabel={s.change}
                onEdit={
                    paying
                        ? undefined
                        : () => {
                              shop.goTo("pickup");
                          }
                }
            >
                <div className="space-y-4">
                    <Choice
                        label={s.pickupDay}
                        layout="tiles"
                        columns={4}
                        value={shop.pickupDay}
                        onChange={shop.setPickupDay}
                        options={shop.pickupDays}
                        className="max-sm:grid-cols-2"
                    />
                    {shop.pickupWindows.length ? (
                        <Choice
                            label={s.pickupWindow}
                            layout="tiles"
                            columns={3}
                            value={shop.pickupFrom}
                            onChange={shop.setPickupFrom}
                            options={shop.pickupWindows}
                        />
                    ) : (
                        <p className="text-sm text-muted">{s.pickupWhen}</p>
                    )}
                    {shop.pickup ? (
                        <p className="text-xs text-muted">
                            {formatParts([shop.zoneNote, s.pickupHold(shop.pickup.hold_days)])}
                        </p>
                    ) : null}
                    <TextField
                        label={s.pickupNote}
                        value={shop.note}
                        onChange={shop.setNote}
                        maxLength={1000}
                        optional
                        multiline
                    />
                </div>
            </StepCard>
            <StepCard
                n={2}
                title={s.sectionDetails}
                summary={shop.name}
                state={shop.step === "details" ? "open" : paying ? "done" : "todo"}
                editLabel={s.change}
            >
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                        <TextField
                            label={s.name}
                            value={shop.name}
                            onChange={shop.setName}
                            autoComplete="name"
                        />
                    </div>
                    <TextField
                        label={s.phone}
                        type="tel"
                        required
                        value={shop.phone}
                        onChange={shop.setPhone}
                        autoComplete="tel"
                    />
                    <p className="text-xs text-muted sm:col-span-2">{s.reach}</p>
                    <div className="sm:col-span-2">
                        <Toggle
                            label={strings.publicOrder.alerts}
                            value={shop.notifySms}
                            onChange={shop.setNotifySms}
                        />
                    </div>
                    {!takingPayments ? (
                        <div className="sm:col-span-2">
                            <Notice tone="info">{s.notTakingPayments}</Notice>
                        </div>
                    ) : null}
                </div>
            </StepCard>
            <StepCard
                n={3}
                title={s.sectionPay}
                state={paying ? "open" : "todo"}
                editLabel={s.change}
            >
                <div className="space-y-4">
                    <ShopPay shop={shop} />
                    <p className="flex items-start gap-2 text-xs text-muted">
                        <Icon name="lock" size={14} />
                        {strings.publicBooking.secure}
                    </p>
                </div>
            </StepCard>
        </div>
    );
}

function OrderSummary({ shop }: { shop: ShopFlow }) {
    if (shop.lines.length === 0 && shop.order === null)
        return <p className="mt-3 text-sm text-muted">{s.cartEmpty}</p>;
    const locked = shop.order !== null;
    return (
        <div className="mt-4 space-y-4">
            <div className="divide-y divide-line-soft">
                {shop.lines.map((l) => (
                    <LineItem
                        key={l.item.id}
                        leading={<ItemImage src={l.item.image_url} name={l.item.name} size={44} />}
                        title={l.item.name}
                        cents={l.item.price_cents * l.quantity}
                        currency={l.item.currency}
                        count={locked ? l.quantity : undefined}
                        quantity={
                            locked
                                ? undefined
                                : {
                                      value: l.quantity,
                                      min: 1,
                                      max: l.max,
                                      onChange: (n) => {
                                          shop.setLine(l.item, n);
                                      },
                                      label: l.item.name,
                                  }
                        }
                        onRemove={
                            locked
                                ? undefined
                                : () => {
                                      shop.setLine(l.item, 0);
                                  }
                        }
                        removeLabel={strings.common.labelValue(s.remove, l.item.name)}
                    />
                ))}
            </div>
            <div className="border-t border-line pt-3">
                <DocTotals lines={shop.totalLines} currency={shop.currency} density="compact" />
                <p className="pt-2 text-xs text-muted">{s.taxNote}</p>
            </div>
            <div className="rounded-xl bg-accent-weak p-3.5">
                <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <Icon name="pin" size={16} />
                    {s.pickupTitle}
                </p>
                <p className="mt-1 text-xs text-muted">
                    {shop.step === "pickup" ? s.pickupWhen : shop.pickupLabel}
                </p>
            </div>
        </div>
    );
}

function ShopPay({ shop }: { shop: ShopFlow }) {
    const o = shop.order;
    if (o === null) return null;
    const total = formatMoney(o.total_cents, o.currency);
    return (
        <div className="space-y-4">
            <p className="text-sm text-muted">{s.payBody(total)}</p>
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
