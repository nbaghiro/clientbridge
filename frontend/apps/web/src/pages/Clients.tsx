import {
    type ClientRow,
    type PackageRow,
    type SavedCardRow,
    type SubscriptionRow,
    canConsume,
    canBeDefault,
    canManagePayments,
    cancelSubscription,
    clientStatusIntent,
    consumeSession,
    detachCard,
    filterClients,
    formatDate,
    initials,
    isCancelable,
    isMandate,
    mandateStatusIntent,
    packageStatusIntent,
    parseTimestamp,
    savedCardLabel,
    sessionsRemaining,
    setDefaultCard,
    strings,
    subscriptionStatusIntent,
    useAddPaymentMethod,
    useAsyncAction,
    useClientForm,
    useClientPackages,
    useClientSubscriptions,
    useClients,
    useSavedCards,
    useSearch,
} from "@clientbridge/app-core";
import {
    Badge,
    Button,
    confirm,
    DetailSection,
    DetailView,
    ListPage,
    Modal,
    Money,
    Notice,
    PaymentMethodForm,
    StatusPill,
    TextField,
} from "@clientbridge/ui";
import { type SubmitEvent, useState } from "react";

import { SellPackage, StartSubscription } from "../components/EntitlementSales";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";

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
        <Button variant="link" onPress={onClick}>
            {label}
        </Button>
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
    const isDefault = card.preferred === 1;

    const makeDefault = (): void => {
        run(() => setDefaultCard(api, card.id), {
            errorMessage: strings.clients.setDefaultError,
        });
    };

    const remove = (): void => {
        confirm({
            title: strings.clients.removeMethodTitle,
            message: strings.clients.removeMethodConfirm,
            confirmLabel: strings.clients.remove,
            destructive: true,
        })
            .then((ok) => {
                if (ok) {
                    run(() => detachCard(api, card.id), {
                        errorMessage: strings.clients.removeMethodError,
                    });
                }
            })
            .catch(() => undefined);
    };

    return (
        <div className="px-3 py-2.5 text-sm">
            <div className="flex items-center gap-2">
                <span className="font-medium text-ink">{savedCardLabel(card)}</span>
                {isDefault ? <Badge label={strings.clients.defaultTag} /> : null}
                {isMandate(card) ? (
                    <StatusPill
                        status={card.mandate_status}
                        intent={mandateStatusIntent(card.mandate_status)}
                    />
                ) : null}
                <div className="ml-auto flex shrink-0 gap-2">
                    {canBeDefault(card) ? (
                        <Button variant="outline" size="sm" disabled={busy} onPress={makeDefault}>
                            {strings.clients.makeDefault}
                        </Button>
                    ) : null}
                    <Button variant="outline" size="sm" disabled={busy} onPress={remove}>
                        {strings.clients.remove}
                    </Button>
                </div>
            </div>
            {error !== null ? <Notice tone="danger">{error}</Notice> : null}
        </div>
    );
}

function SubscriptionsSection({ clientId }: { clientId: string }) {
    const subs = useClientSubscriptions(clientId);
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
                <StartSubscription
                    clientId={clientId}
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
        confirm({
            title: strings.clients.cancelSubscriptionTitle,
            message: strings.clients.cancelSubscriptionConfirm,
            confirmLabel: strings.clients.cancelSubscriptionTitle,
            cancelLabel: strings.clients.keep,
            destructive: true,
        })
            .then((ok) => {
                if (ok) {
                    run(() => cancelSubscription(api, sub.id), {
                        errorMessage: strings.clients.cancelSubscriptionError,
                    });
                }
            })
            .catch(() => undefined);
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
                        <Button variant="outline" size="sm" disabled={busy} onPress={cancel}>
                            {busy ? strings.clients.canceling : strings.common.cancel}
                        </Button>
                    ) : null}
                </div>
            </div>
            {error !== null ? <Notice tone="danger">{error}</Notice> : null}
        </div>
    );
}

function PackagesSection({ clientId }: { clientId: string }) {
    const packages = useClientPackages(clientId);
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
                <SellPackage
                    clientId={clientId}
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
                        <Button variant="outline" size="sm" disabled={busy} onPress={consume}>
                            {busy ? strings.common.busyEllipsis : strings.clients.consumeSession}
                        </Button>
                    ) : null}
                </div>
            </div>
            {error !== null ? <Notice tone="danger">{error}</Notice> : null}
        </div>
    );
}

function AddClientModal({ onClose }: { onClose: () => void }) {
    const form = useClientForm(api, onClose);
    const submit = (e: SubmitEvent): void => {
        e.preventDefault();
        form.submit();
    };

    return (
        <Modal onClose={onClose} size="sm">
            <form onSubmit={submit}>
                <h2 className="font-display text-lg font-bold text-ink">
                    {strings.clients.addClientTitle}
                </h2>
                <div className="mt-4 flex flex-col gap-3">
                    <TextField
                        label={strings.clients.nameLabel}
                        value={form.name}
                        onChange={form.setName}
                        autoFocus
                    />
                    <TextField
                        label={strings.clients.emailLabel}
                        type="email"
                        value={form.email}
                        onChange={form.setEmail}
                    />
                    <TextField
                        label={strings.clients.phoneLabel}
                        type="tel"
                        value={form.phone}
                        onChange={form.setPhone}
                    />
                    {form.error ? <Notice tone="danger">{form.error}</Notice> : null}
                </div>
                <div className="mt-5 flex justify-end gap-2">
                    <Button variant="quiet" onPress={onClose}>
                        {strings.common.cancel}
                    </Button>
                    <Button submit busy={form.busy}>
                        {form.busy ? strings.clients.adding : strings.clients.addClient}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
