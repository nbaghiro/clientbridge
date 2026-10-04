import {
    type ClientRow,
    type ItemRow,
    type PackageRow,
    type SavedCardRow,
    type SubscriptionRow,
    canConsume,
    canBeDefault,
    canManagePayments,
    checkoutMethods,
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
import { ChargeSheet, PaymentMethodForm, StatusPill } from "@clientbridge/ui";
import { type SubmitEvent, useMemo, useState } from "react";

import { DetailSection, DetailView } from "../components/DetailView";
import { ListPage } from "../components/ListPage";
import { Money } from "../components/Money";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";

const field =
    "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-hidden placeholder:text-muted focus:border-accent";

export function Clients() {
    const clients = useClients();
    const { q, setQ, filtered } = useSearch(clients, filterClients);
    const [adding, setAdding] = useState(false);
    const [openId, setOpenId] = useState<string | null>(null);
    const showValue = canManagePayments(useRole());
    const grid = showValue
        ? "grid grid-cols-[2fr_1fr_1fr_1fr] items-center gap-4"
        : "grid grid-cols-[2fr_1fr_1fr] items-center gap-4";

    return (
        <div className="mx-auto max-w-5xl px-8 py-8">
            <ListPage
                title={strings.clients.title}
                summary={strings.clients.total(clients.length)}
                action={{
                    label: strings.clients.add,
                    onPress: () => {
                        setAdding(true);
                    },
                }}
                search={{
                    value: q,
                    onChange: setQ,
                    placeholder: strings.clients.searchPlaceholder,
                }}
                head={
                    <div className={grid}>
                        <span>{strings.clients.colName}</span>
                        <span>{strings.clients.colPhone}</span>
                        <span>{strings.clients.colStatus}</span>
                        {showValue ? (
                            <span className="text-right">{strings.clients.colLifetime}</span>
                        ) : null}
                    </div>
                }
                rows={filtered}
                rowKey={(c) => c.id}
                onRowPress={(c) => {
                    setOpenId(c.id);
                }}
                empty={q ? strings.clients.emptySearch : strings.clients.empty}
                renderRow={(c) => (
                    <div className={grid}>
                        <div className="flex items-center gap-3">
                            <Avatar name={c.name} />
                            <div className="min-w-0">
                                <div className="truncate font-medium text-ink">{c.name}</div>
                                {c.email ? (
                                    <div className="truncate text-xs text-muted">{c.email}</div>
                                ) : null}
                            </div>
                        </div>
                        <span className="text-ink-soft">{c.phone ?? strings.clients.dash}</span>
                        <span>
                            <StatusPill status={c.status} intent={clientStatusIntent(c.status)} />
                        </span>
                        {showValue ? (
                            <span className="text-right">
                                <Money cents={c.lifetime_value_cents} />
                            </span>
                        ) : null}
                    </div>
                )}
            />

            {adding ? (
                <AddClientModal
                    onClose={() => {
                        setAdding(false);
                    }}
                />
            ) : null}
            <ClientDetail
                client={filtered.find((c) => c.id === openId) ?? null}
                onClose={() => {
                    setOpenId(null);
                }}
            />
        </div>
    );
}

function Avatar({ name, large = false }: { name: string; large?: boolean }) {
    return (
        <span
            className={`flex shrink-0 items-center justify-center rounded-avatar bg-accent-weak font-bold text-accent ${
                large ? "h-10 w-10 text-sm" : "h-8 w-8 text-xs"
            }`}
        >
            {initials(name)}
        </span>
    );
}

function Overlay({ children }: { children: React.ReactNode }) {
    return (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-scrim p-4">
            {children}
        </div>
    );
}

function ClientDetail({ client, onClose }: { client: ClientRow | null; onClose: () => void }) {
    const canManage = canManagePayments(useRole());
    if (client === null) return null;

    return (
        <DetailView
            open
            title={client.name}
            subtitle={client.email ?? client.phone ?? strings.clients.dash}
            status={{ status: client.status, intent: clientStatusIntent(client.status) }}
            leading={<Avatar name={client.name} large />}
            onClose={onClose}
        >
            {canManage ? (
                <>
                    <PaymentMethodsSection clientId={client.id} />
                    <SubscriptionsSection clientId={client.id} />
                    <PackagesSection clientId={client.id} />
                </>
            ) : (
                <p className="text-sm text-muted">{strings.clients.manageRestricted}</p>
            )}
        </DetailView>
    );
}

function SectionLink({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="text-sm font-medium text-accent transition hover:opacity-80"
        >
            {label}
        </button>
    );
}

function PaymentMethodsSection({ clientId }: { clientId: string }) {
    const cards = useSavedCards(clientId);
    const flow = useAddPaymentMethod(api, clientId, () => undefined);

    return (
        <DetailSection title={strings.clients.paymentMethods}>
            {cards.length === 0 ? (
                <p className="text-sm text-muted">{strings.clients.noPaymentMethods}</p>
            ) : (
                <div className="divide-y divide-line-soft rounded-md border border-line">
                    {cards.map((card) => (
                        <CardRow key={card.id} card={card} />
                    ))}
                </div>
            )}

            <PaymentMethodForm flow={flow} allowBank />
        </DetailSection>
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
                    {canBeDefault(card) ? (
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

function SubscriptionsSection({ clientId }: { clientId: string }) {
    const subs = useClientSubscriptions(clientId);
    const cards = useSavedCards(clientId);
    const items = useCatalogItems();
    const plans = useMemo(() => subscriptionPlans(items), [items]);
    const [starting, setStarting] = useState(false);

    return (
        <DetailSection
            title={strings.clients.subscriptions}
            action={
                starting ? undefined : (
                    <SectionLink
                        label={strings.clients.startSubscriptionLink}
                        onClick={() => {
                            setStarting(true);
                        }}
                    />
                )
            }
        >
            {subs.length === 0 ? (
                <p className="text-sm text-muted">{strings.clients.noSubscriptions}</p>
            ) : (
                <div className="divide-y divide-line-soft rounded-md border border-line">
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
        </DetailSection>
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
    const plan = plans.find((p) => p.id === form.itemId);

    return (
        <ChargeSheet
            checkout={form.checkout}
            methods={checkoutMethods(cards)}
            amountLabel={plan ? formatMoney(plan.price_cents) : ""}
            stripeAccount=""
            submitLabel={strings.clients.startSubscription}
            busyLabel={strings.clients.starting}
            onSubmit={form.submit}
            onCancel={onClose}
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
            {plans.length === 0 ? (
                <p className="text-xs text-muted">{strings.clients.addSubscriptionItemFirst}</p>
            ) : null}
        </ChargeSheet>
    );
}

function PackagesSection({ clientId }: { clientId: string }) {
    const packages = useClientPackages(clientId);
    const cards = useSavedCards(clientId);
    const items = useCatalogItems();
    const offerings = useMemo(() => packageOfferings(items), [items]);
    const [selling, setSelling] = useState(false);

    return (
        <DetailSection
            title={strings.clients.packages}
            action={
                selling ? undefined : (
                    <SectionLink
                        label={strings.clients.sellPackageLink}
                        onClick={() => {
                            setSelling(true);
                        }}
                    />
                )
            }
        >
            {packages.length === 0 ? (
                <p className="text-sm text-muted">{strings.clients.noPackages}</p>
            ) : (
                <div className="divide-y divide-line-soft rounded-md border border-line">
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
        </DetailSection>
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
    const offering = offerings.find((o) => o.id === form.itemId);

    return (
        <ChargeSheet
            checkout={form.checkout}
            methods={checkoutMethods(cards)}
            amountLabel={
                offering ? formatMoney(offering.price_cents) : strings.clients.packageAmountFallback
            }
            stripeAccount={stripeAccount}
            submitLabel={strings.clients.sellPackage}
            busyLabel={strings.clients.selling}
            onSubmit={form.submit}
            onCancel={onClose}
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
            {offerings.length === 0 ? (
                <p className="text-xs text-muted">{strings.clients.addPackageItemFirst}</p>
            ) : null}
        </ChargeSheet>
    );
}

function AddClientModal({ onClose }: { onClose: () => void }) {
    const form = useClientForm(api, onClose);
    const submit = (e: SubmitEvent): void => {
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
