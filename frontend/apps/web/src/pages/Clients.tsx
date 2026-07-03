import {
    type AddPaymentMethod,
    type ClientRow,
    type ItemRow,
    type PackageRow,
    type SavedCardRow,
    type SubscriptionRow,
    canConsume,
    canManagePayments,
    cancelSubscription,
    clientStatusIntent,
    consumeSession,
    detachCard,
    filterClients,
    formatDate,
    formatMoney,
    initials,
    isCancelable,
    isMandate,
    mandateStatusIntent,
    packageOfferings,
    packageStatusIntent,
    parseTimestamp,
    savedCardLabel,
    sessionsRemaining,
    setDefaultCard,
    strings,
    subscriptionPlans,
    subscriptionStatusIntent,
    useAddPaymentMethod,
    useAsyncAction,
    useCatalogItems,
    useClientForm,
    useClientPackages,
    useClientSubscriptions,
    useClients,
    usePackageSaleForm,
    useSavedCards,
    useSearch,
    useStripeAccountId,
    useSubscriptionForm,
} from "@clientbridge/app-core";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { type Stripe, loadStripe } from "@stripe/stripe-js";
import { type FormEvent, useMemo, useState } from "react";

import { IconPlus, IconSearch } from "../components/icons";
import { CardConfirm } from "../components/CardConfirm";
import { StatusPill } from "../components/StatusPill";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";

const PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

const field =
    "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-accent";

export function Clients() {
    const clients = useClients();
    const { q, setQ, filtered } = useSearch(clients, filterClients);
    const [adding, setAdding] = useState(false);
    const [openId, setOpenId] = useState<string | null>(null);

    return (
        <div className="mx-auto max-w-5xl px-8 py-8">
            <header className="flex items-center justify-between gap-4">
                <div>
                    <h1 className="font-display text-2xl font-bold">{strings.clients.title}</h1>
                    <p className="mt-0.5 text-sm text-muted">
                        {strings.clients.total(clients.length)}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        setAdding(true);
                    }}
                    className="flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90"
                >
                    <IconPlus className="h-4 w-4" /> {strings.clients.add}
                </button>
            </header>

            <div className="relative mt-6">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                    value={q}
                    onChange={(e) => {
                        setQ(e.target.value);
                    }}
                    placeholder={strings.clients.searchPlaceholder}
                    className="w-full rounded-md border border-line bg-surface py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-muted focus:border-accent"
                />
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-line bg-surface">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                            <th className="px-4 py-3 font-semibold">{strings.clients.colName}</th>
                            <th className="px-4 py-3 font-semibold">{strings.clients.colPhone}</th>
                            <th className="px-4 py-3 font-semibold">{strings.clients.colStatus}</th>
                            <th className="px-4 py-3 text-right font-semibold">
                                {strings.clients.colLifetime}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map((c) => (
                            <tr
                                key={c.id}
                                onClick={() => {
                                    setOpenId(c.id);
                                }}
                                className="cursor-pointer border-b border-line-soft transition last:border-0 hover:bg-bg"
                            >
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-3">
                                        <span className="flex h-8 w-8 items-center justify-center rounded-avatar bg-accent-weak text-xs font-bold text-accent">
                                            {initials(c.name)}
                                        </span>
                                        <div>
                                            <div className="font-medium text-ink">{c.name}</div>
                                            {c.email ? (
                                                <div className="text-xs text-muted">{c.email}</div>
                                            ) : null}
                                        </div>
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-ink-soft">
                                    {c.phone ?? strings.clients.dash}
                                </td>
                                <td className="px-4 py-3">
                                    <StatusPill
                                        status={c.status}
                                        intent={clientStatusIntent(c.status)}
                                    />
                                </td>
                                <td className="px-4 py-3 text-right font-medium tabular-nums text-ink">
                                    {formatMoney(c.lifetime_value_cents)}
                                </td>
                            </tr>
                        ))}
                        {filtered.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={4}
                                    className="px-4 py-12 text-center text-sm text-muted"
                                >
                                    {q ? strings.clients.emptySearch : strings.clients.empty}
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>

            {adding ? (
                <AddClientModal
                    onClose={() => {
                        setAdding(false);
                    }}
                />
            ) : null}
            {openId !== null ? (
                <ClientDetailModal
                    client={filtered.find((c) => c.id === openId) ?? null}
                    onClose={() => {
                        setOpenId(null);
                    }}
                />
            ) : null}
        </div>
    );
}

function Overlay({ children }: { children: React.ReactNode }) {
    return (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-scrim p-4">
            {children}
        </div>
    );
}

function ClientDetailModal({ client, onClose }: { client: ClientRow | null; onClose: () => void }) {
    const role = useRole();
    if (client === null) return null;
    const canManage = canManagePayments(role);

    return (
        <Overlay>
            <div className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-lg border border-line bg-surface shadow-card">
                <div className="flex items-start justify-between border-b border-line px-6 py-4">
                    <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-avatar bg-accent-weak text-sm font-bold text-accent">
                            {initials(client.name)}
                        </span>
                        <div>
                            <h2 className="font-display text-lg font-bold text-ink">
                                {client.name}
                            </h2>
                            <p className="mt-0.5 text-sm text-muted">
                                {client.email ?? client.phone ?? strings.clients.dash}
                            </p>
                        </div>
                    </div>
                    <StatusPill status={client.status} intent={clientStatusIntent(client.status)} />
                </div>
                <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
                    {canManage ? (
                        <>
                            <PaymentMethodsSection clientId={client.id} />
                            <SubscriptionsSection clientId={client.id} />
                            <PackagesSection clientId={client.id} />
                        </>
                    ) : (
                        <p className="text-sm text-muted">{strings.clients.manageRestricted}</p>
                    )}
                </div>
                <div className="flex justify-end border-t border-line px-6 py-4">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-bg"
                    >
                        {strings.common.close}
                    </button>
                </div>
            </div>
        </Overlay>
    );
}

function PaymentMethodsSection({ clientId }: { clientId: string }) {
    const cards = useSavedCards(clientId);
    const flow = useAddPaymentMethod(api, clientId, () => undefined);

    return (
        <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                {strings.clients.paymentMethods}
            </h3>
            {cards.length === 0 ? (
                <p className="mt-2 text-sm text-muted">{strings.clients.noPaymentMethods}</p>
            ) : (
                <div className="mt-2 divide-y divide-line-soft rounded-md border border-line">
                    {cards.map((card) => (
                        <CardRow key={card.id} card={card} />
                    ))}
                </div>
            )}

            {flow.intent !== null && flow.kind !== null ? (
                <SetupCardPanel flow={flow} />
            ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                    <button
                        type="button"
                        disabled={flow.busy}
                        onClick={() => {
                            flow.start("card");
                        }}
                        className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink-soft transition hover:bg-bg disabled:opacity-60"
                    >
                        {flow.busy && flow.kind === "card"
                            ? strings.clients.starting
                            : strings.clients.addCard}
                    </button>
                    <button
                        type="button"
                        disabled={flow.busy}
                        onClick={() => {
                            flow.start("bank");
                        }}
                        className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink-soft transition hover:bg-bg disabled:opacity-60"
                    >
                        {flow.busy && flow.kind === "bank"
                            ? strings.clients.starting
                            : strings.clients.addBankWeb}
                    </button>
                </div>
            )}
            {flow.error !== null ? <p className="mt-2 text-sm text-danger">{flow.error}</p> : null}
        </section>
    );
}

function CardRow({ card }: { card: SavedCardRow }) {
    const { busy, error, run } = useAsyncAction();
    const isDefault = card.is_default === 1;

    const makeDefault = (): void => {
        run(() => setDefaultCard(api, card.id), {
            errorMessage: strings.clients.setDefaultError,
        });
    };

    const remove = (): void => {
        if (!window.confirm(strings.clients.removeMethodConfirm)) return;
        run(() => detachCard(api, card.id), {
            errorMessage: strings.clients.removeMethodError,
        });
    };

    return (
        <div className="px-3 py-2.5 text-sm">
            <div className="flex items-center gap-2">
                <span className="font-medium text-ink">{savedCardLabel(card)}</span>
                {isDefault ? (
                    <span className="rounded-full bg-accent-weak px-2 py-0.5 text-xs font-medium text-accent">
                        {strings.clients.defaultTag}
                    </span>
                ) : null}
                {isMandate(card) ? (
                    <StatusPill
                        status={card.mandate_status}
                        intent={mandateStatusIntent(card.mandate_status)}
                    />
                ) : null}
                <div className="ml-auto flex shrink-0 gap-2">
                    {!isDefault ? (
                        <button
                            type="button"
                            disabled={busy}
                            onClick={makeDefault}
                            className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink-soft transition hover:bg-bg disabled:opacity-60"
                        >
                            {strings.clients.makeDefault}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        disabled={busy}
                        onClick={remove}
                        className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink-soft transition hover:bg-bg disabled:opacity-60"
                    >
                        {strings.clients.remove}
                    </button>
                </div>
            </div>
            {error !== null ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
        </div>
    );
}

function SetupCardPanel({ flow }: { flow: AddPaymentMethod }) {
    const intent = flow.intent;
    const account = intent?.stripe_account_id ?? "";
    // Direct charge on the connected account: Elements must target that Stripe account.
    const stripePromise = useMemo<Promise<Stripe | null> | null>(
        () =>
            PUBLISHABLE_KEY && account
                ? loadStripe(PUBLISHABLE_KEY, { stripeAccount: account })
                : null,
        [account],
    );

    if (intent === null) return null;
    if (stripePromise === null)
        return <p className="mt-3 text-sm text-danger">{strings.clients.stripeNotConfigured}</p>;

    return (
        <div className="mt-3 rounded-md border border-line bg-bg p-4">
            <Elements stripe={stripePromise} options={{ clientSecret: intent.client_secret }}>
                <SetupForm flow={flow} />
            </Elements>
        </div>
    );
}

function SetupForm({ flow }: { flow: AddPaymentMethod }) {
    const stripe = useStripe();
    const elements = useElements();
    const { busy, error, setError, run } = useAsyncAction();
    const noun = flow.kind === "bank" ? strings.clients.bankAccountNoun : strings.clients.cardNoun;

    const submit = (e: FormEvent): void => {
        e.preventDefault();
        if (!stripe || !elements) return;
        run(
            async () => {
                const result = await stripe.confirmSetup({ elements, redirect: "if_required" });
                if (result.error) {
                    setError(result.error.message ?? strings.clients.saveMethodShortError(noun));
                    return;
                }
                flow.complete();
            },
            { errorMessage: strings.clients.saveMethodError(noun) },
        );
    };

    return (
        <form onSubmit={submit} className="space-y-3">
            <PaymentElement />
            {error !== null ? <p className="text-sm text-danger">{error}</p> : null}
            <div className="flex justify-end gap-2">
                <button
                    type="button"
                    onClick={flow.cancel}
                    className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-surface"
                >
                    {strings.common.cancel}
                </button>
                <button
                    type="submit"
                    disabled={busy || !stripe}
                    className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                >
                    {busy ? strings.common.saving : strings.clients.saveMethod(noun)}
                </button>
            </div>
        </form>
    );
}

function SubscriptionsSection({ clientId }: { clientId: string }) {
    const subs = useClientSubscriptions(clientId);
    const cards = useSavedCards(clientId);
    const items = useCatalogItems();
    const plans = useMemo(() => subscriptionPlans(items), [items]);
    const [starting, setStarting] = useState(false);

    return (
        <section>
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {strings.clients.subscriptions}
                </h3>
                {!starting ? (
                    <button
                        type="button"
                        onClick={() => {
                            setStarting(true);
                        }}
                        className="text-sm font-medium text-accent transition hover:opacity-80"
                    >
                        {strings.clients.startSubscriptionLink}
                    </button>
                ) : null}
            </div>

            {subs.length === 0 ? (
                <p className="mt-2 text-sm text-muted">{strings.clients.noSubscriptions}</p>
            ) : (
                <div className="mt-2 divide-y divide-line-soft rounded-md border border-line">
                    {subs.map((sub) => (
                        <SubscriptionRowItem key={sub.id} sub={sub} />
                    ))}
                </div>
            )}

            {starting ? (
                <StartSubscriptionForm
                    clientId={clientId}
                    plans={plans}
                    cards={cards}
                    onClose={() => {
                        setStarting(false);
                    }}
                />
            ) : null}
        </section>
    );
}

function SubscriptionRowItem({ sub }: { sub: SubscriptionRow }) {
    const { busy, error, run } = useAsyncAction();
    const nextCharge =
        sub.current_period_end !== null ? formatDate(parseTimestamp(sub.current_period_end)) : null;

    const cancel = (): void => {
        if (!window.confirm(strings.clients.cancelSubscriptionConfirm)) return;
        run(() => cancelSubscription(api, sub.id), {
            errorMessage: strings.clients.cancelSubscriptionError,
        });
    };

    return (
        <div className="px-3 py-2.5 text-sm">
            <div className="flex items-center gap-2">
                <div className="min-w-0">
                    <div className="font-medium text-ink">
                        {sub.item_name ?? strings.clients.subscriptionFallback}
                    </div>
                    {nextCharge !== null ? (
                        <div className="text-xs text-muted">
                            {strings.clients.nextCharge(nextCharge)}
                        </div>
                    ) : null}
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    <StatusPill status={sub.status} intent={subscriptionStatusIntent(sub.status)} />
                    {isCancelable(sub.status) ? (
                        <button
                            type="button"
                            disabled={busy}
                            onClick={cancel}
                            className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink-soft transition hover:bg-bg disabled:opacity-60"
                        >
                            {busy ? strings.clients.canceling : strings.common.cancel}
                        </button>
                    ) : null}
                </div>
            </div>
            {error !== null ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
        </div>
    );
}

function StartSubscriptionForm({
    clientId,
    plans,
    cards,
    onClose,
}: {
    clientId: string;
    plans: ItemRow[];
    cards: SavedCardRow[];
    onClose: () => void;
}) {
    const form = useSubscriptionForm(api, clientId, onClose);

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                form.submit();
            }}
            className="mt-3 space-y-3 rounded-md border border-line bg-bg p-4"
        >
            <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                {strings.clients.planLabel}
                <select
                    value={form.itemId}
                    onChange={(e) => {
                        form.setItemId(e.target.value);
                    }}
                    className={field}
                >
                    <option value="">{strings.clients.selectPlan}</option>
                    {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.name} — {formatMoney(p.price_cents)}
                        </option>
                    ))}
                </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                {strings.clients.paymentMethodLabel}
                <select
                    value={form.paymentMethodId}
                    onChange={(e) => {
                        form.setPaymentMethodId(e.target.value);
                    }}
                    className={field}
                >
                    <option value="">{strings.clients.selectSavedMethod}</option>
                    {cards.map((card) => (
                        <option key={card.id} value={card.id}>
                            {savedCardLabel(card)}
                        </option>
                    ))}
                </select>
            </label>
            {plans.length === 0 ? (
                <p className="text-xs text-muted">{strings.clients.addSubscriptionItemFirst}</p>
            ) : null}
            {cards.length === 0 ? (
                <p className="text-xs text-muted">{strings.clients.addPaymentMethodFirst}</p>
            ) : null}
            {form.error !== null ? <p className="text-sm text-danger">{form.error}</p> : null}
            <div className="flex justify-end gap-2">
                <button
                    type="button"
                    onClick={onClose}
                    className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-surface"
                >
                    {strings.common.cancel}
                </button>
                <button
                    type="submit"
                    disabled={form.busy}
                    className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                >
                    {form.busy ? strings.clients.starting : strings.clients.startSubscription}
                </button>
            </div>
        </form>
    );
}

function PackagesSection({ clientId }: { clientId: string }) {
    const packages = useClientPackages(clientId);
    const cards = useSavedCards(clientId);
    const items = useCatalogItems();
    const offerings = useMemo(() => packageOfferings(items), [items]);
    const [selling, setSelling] = useState(false);

    return (
        <section>
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {strings.clients.packages}
                </h3>
                {!selling ? (
                    <button
                        type="button"
                        onClick={() => {
                            setSelling(true);
                        }}
                        className="text-sm font-medium text-accent transition hover:opacity-80"
                    >
                        {strings.clients.sellPackageLink}
                    </button>
                ) : null}
            </div>

            {packages.length === 0 ? (
                <p className="mt-2 text-sm text-muted">{strings.clients.noPackages}</p>
            ) : (
                <div className="mt-2 divide-y divide-line-soft rounded-md border border-line">
                    {packages.map((pkg) => (
                        <PackageRowItem key={pkg.id} pkg={pkg} />
                    ))}
                </div>
            )}

            {selling ? (
                <SellPackageForm
                    clientId={clientId}
                    offerings={offerings}
                    cards={cards}
                    onClose={() => {
                        setSelling(false);
                    }}
                />
            ) : null}
        </section>
    );
}

function PackageRowItem({ pkg }: { pkg: PackageRow }) {
    const { busy, error, run } = useAsyncAction();

    const consume = (): void => {
        run(() => consumeSession(api, pkg.id), {
            errorMessage: strings.clients.consumeSessionError,
        });
    };

    return (
        <div className="px-3 py-2.5 text-sm">
            <div className="flex items-center gap-2">
                <div className="min-w-0">
                    <div className="font-medium text-ink">
                        {pkg.item_name ?? strings.clients.packageFallback}
                    </div>
                    <div className="text-xs text-muted">
                        {strings.clients.sessionsLeft(sessionsRemaining(pkg), pkg.sessions_total)}
                    </div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    <StatusPill status={pkg.status} intent={packageStatusIntent(pkg.status)} />
                    {canConsume(pkg) ? (
                        <button
                            type="button"
                            disabled={busy}
                            onClick={consume}
                            className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink-soft transition hover:bg-bg disabled:opacity-60"
                        >
                            {busy ? strings.clients.busyEllipsis : strings.clients.consumeSession}
                        </button>
                    ) : null}
                </div>
            </div>
            {error !== null ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
        </div>
    );
}

function SellPackageForm({
    clientId,
    offerings,
    cards,
    onClose,
}: {
    clientId: string;
    offerings: ItemRow[];
    cards: SavedCardRow[];
    onClose: () => void;
}) {
    const form = usePackageSaleForm(api, clientId, onClose);
    const stripeAccount = useStripeAccountId() ?? "";

    if (form.clientSecret !== null) {
        const offering = offerings.find((o) => o.id === form.itemId) ?? null;
        return (
            <CardConfirm
                clientSecret={form.clientSecret}
                stripeAccount={stripeAccount}
                amountLabel={
                    offering
                        ? formatMoney(offering.price_cents)
                        : strings.clients.packageAmountFallback
                }
                onPaid={form.complete}
                onCancel={form.cancel}
            />
        );
    }

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                form.submit();
            }}
            className="mt-3 space-y-3 rounded-md border border-line bg-bg p-4"
        >
            <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                {strings.clients.packageLabel}
                <select
                    value={form.itemId}
                    onChange={(e) => {
                        form.setItemId(e.target.value);
                    }}
                    className={field}
                >
                    <option value="">{strings.clients.selectPackage}</option>
                    {offerings.map((o) => (
                        <option key={o.id} value={o.id}>
                            {o.name} — {formatMoney(o.price_cents)}
                        </option>
                    ))}
                </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                {strings.clients.paymentLabel}
                <select
                    value={form.paymentMethodId}
                    onChange={(e) => {
                        form.setPaymentMethodId(e.target.value);
                    }}
                    className={field}
                >
                    <option value="">{strings.clients.payWithNewCard}</option>
                    {cards.map((card) => (
                        <option key={card.id} value={card.id}>
                            {savedCardLabel(card)}
                        </option>
                    ))}
                </select>
            </label>
            {offerings.length === 0 ? (
                <p className="text-xs text-muted">{strings.clients.addPackageItemFirst}</p>
            ) : null}
            {form.error !== null ? <p className="text-sm text-danger">{form.error}</p> : null}
            <div className="flex justify-end gap-2">
                <button
                    type="button"
                    onClick={onClose}
                    className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-surface"
                >
                    {strings.common.cancel}
                </button>
                <button
                    type="submit"
                    disabled={form.busy}
                    className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                >
                    {form.busy ? strings.clients.selling : strings.clients.sellPackage}
                </button>
            </div>
        </form>
    );
}

function AddClientModal({ onClose }: { onClose: () => void }) {
    const form = useClientForm(api, onClose);
    const submit = (e: FormEvent): void => {
        e.preventDefault();
        form.submit();
    };

    return (
        <Overlay>
            <form
                onSubmit={submit}
                className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-card"
            >
                <h2 className="font-display text-lg font-bold text-ink">
                    {strings.clients.addClientTitle}
                </h2>
                <div className="mt-4 flex flex-col gap-3">
                    <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                        {strings.clients.nameLabel}
                        <input
                            value={form.name}
                            onChange={(e) => {
                                form.setName(e.target.value);
                            }}
                            autoFocus
                            className={field}
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                        {strings.clients.emailLabel}
                        <input
                            type="email"
                            value={form.email}
                            onChange={(e) => {
                                form.setEmail(e.target.value);
                            }}
                            className={field}
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                        {strings.clients.phoneLabel}
                        <input
                            value={form.phone}
                            onChange={(e) => {
                                form.setPhone(e.target.value);
                            }}
                            className={field}
                        />
                    </label>
                    {form.error ? <p className="text-sm text-danger-fg">{form.error}</p> : null}
                </div>
                <div className="mt-5 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-bg"
                    >
                        {strings.common.cancel}
                    </button>
                    <button
                        type="submit"
                        disabled={form.busy}
                        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                    >
                        {form.busy ? strings.clients.adding : strings.clients.addClient}
                    </button>
                </div>
            </form>
        </Overlay>
    );
}
