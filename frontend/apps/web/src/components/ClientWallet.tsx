import {
    type PackageRow,
    type SubscriptionRow,
    type WalletMethod,
    canConsume,
    cancelSubscription,
    consumeSession,
    formatDate,
    isCancelable,
    packageStatusIntent,
    parseTimestamp,
    sessionsRemaining,
    strings,
    subscriptionStatusIntent,
    useAddPaymentMethod,
    useAsyncAction,
    useClientPackages,
    useClientSubscriptions,
    useClientWallet,
} from "@clientbridge/app-core";
import {
    ActionMenu,
    Badge,
    BrandMark,
    Button,
    confirm,
    Empty,
    Icon,
    IconButton,
    LoadFailed,
    Notice,
    Panel,
    PaymentMethodForm,
    Skeleton,
    StatusPill,
} from "@clientbridge/ui";
import { useState } from "react";

import { api } from "../lib/api";
import { SellPackage, StartSubscription } from "./EntitlementSales";

const s = strings.clients.wallet;

function MethodRow({ m, wallet }: { m: WalletMethod; wallet: ReturnType<typeof useClientWallet> }) {
    const [menu, setMenu] = useState(false);
    const askRemove = (): void => {
        confirm({
            title: s.removeTitle(m.label),
            message: wallet.removeMessage(m),
            confirmLabel: s.removeConfirm,
            destructive: true,
        })
            .then((ok) => {
                if (ok) wallet.remove(m.row.id);
            })
            .catch(() => undefined);
    };
    return (
        <li
            className={`flex items-center gap-4 px-4 py-3.5 ${wallet.busyId === m.row.id ? "opacity-60" : ""}`}
        >
            <BrandMark method={m.row.method} brand={m.row.brand} />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{m.label}</span>
                    {m.isDefault ? <Badge label={s.default} intent="accent" /> : null}
                    {m.pays.length > 0 ? (
                        <Badge label={s.pays(m.pays.join(", "))} intent="neutral" />
                    ) : null}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    {m.status !== null ? (
                        <StatusPill status={m.status.label} intent={m.status.intent} asWritten />
                    ) : null}
                    {m.expiry !== null ? (
                        <span className={m.expiringSoon ? "font-medium text-warn-fg" : ""}>
                            {m.expiry}
                        </span>
                    ) : null}
                    <span>
                        {[m.bankName, m.holder, m.added, m.note]
                            .filter((x) => x !== null && x !== "")
                            .join(" · ")}
                    </span>
                </div>
            </div>
            <div className="relative">
                <IconButton
                    icon="more"
                    label={s.more(m.label)}
                    onPress={() => {
                        setMenu(true);
                    }}
                />
                <ActionMenu
                    open={menu}
                    onClose={() => {
                        setMenu(false);
                    }}
                    placement="below-end"
                    items={[
                        ...(m.canBeDefault
                            ? [
                                  {
                                      key: "default",
                                      label: s.makeDefault,
                                      hint: s.defaultHint,
                                      icon: "check" as const,
                                  },
                              ]
                            : []),
                        {
                            key: "remove",
                            label: s.remove,
                            hint: wallet.removeMessage(m),
                            icon: "trash" as const,
                        },
                    ]}
                    onSelect={(k) => {
                        setMenu(false);
                        if (k === "default") wallet.makeDefault(m.row.id);
                        else askRemove();
                    }}
                />
            </div>
        </li>
    );
}

function SubscriptionLine({ sub }: { sub: SubscriptionRow }) {
    const { busy, error, run } = useAsyncAction();
    const cancel = (): void => {
        confirm({
            title: strings.clients.cancelSubscriptionTitle,
            message: strings.clients.cancelSubscriptionConfirm,
            confirmLabel: strings.clients.cancelSubscriptionTitle,
            cancelLabel: strings.clients.keep,
            destructive: true,
        })
            .then((ok) => {
                if (ok)
                    run(() => cancelSubscription(api, sub.id), {
                        errorMessage: strings.clients.cancelSubscriptionError,
                    });
            })
            .catch(() => undefined);
    };
    return (
        <li className="px-4 py-3 text-sm">
            <div className="flex items-center gap-2">
                <div className="min-w-0">
                    <div className="font-medium text-ink">
                        {sub.item_name ?? strings.clients.subscriptionFallback}
                    </div>
                    {sub.current_period_end !== null ? (
                        <div className="text-xs text-muted">
                            {strings.clients.nextCharge(
                                formatDate(parseTimestamp(sub.current_period_end)),
                            )}
                        </div>
                    ) : null}
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    <StatusPill status={sub.status} intent={subscriptionStatusIntent(sub.status)} />
                    {isCancelable(sub.status) ? (
                        <Button variant="outline" size="sm" busy={busy} onPress={cancel}>
                            {strings.common.cancel}
                        </Button>
                    ) : null}
                </div>
            </div>
            {error !== null ? <Notice tone="danger">{error}</Notice> : null}
        </li>
    );
}

function PackageLine({ pkg }: { pkg: PackageRow }) {
    const { busy, error, run } = useAsyncAction();
    return (
        <li className="px-4 py-3 text-sm">
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
                        <Button
                            variant="outline"
                            size="sm"
                            busy={busy}
                            onPress={() => {
                                run(() => consumeSession(api, pkg.id), {
                                    errorMessage: strings.clients.consumeSessionError,
                                });
                            }}
                        >
                            {strings.clients.consumeSession}
                        </Button>
                    ) : null}
                </div>
            </div>
            {error !== null ? <Notice tone="danger">{error}</Notice> : null}
        </li>
    );
}

function Plans({ clientId }: { clientId: string }) {
    const subs = useClientSubscriptions(clientId);
    const packages = useClientPackages(clientId);
    const [selling, setSelling] = useState<"package" | "subscription" | null>(null);
    const close = (): void => {
        setSelling(null);
    };
    return (
        <>
            <Panel
                title={strings.clients.subscriptions}
                flush
                actions={
                    <Button
                        size="sm"
                        variant="link"
                        onPress={() => {
                            setSelling("subscription");
                        }}
                    >
                        {strings.clients.startSubscriptionLink}
                    </Button>
                }
            >
                {subs.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-muted">
                        {strings.clients.noSubscriptions}
                    </p>
                ) : (
                    <ul className="divide-y divide-line-soft">
                        {subs.map((sub) => (
                            <SubscriptionLine key={sub.id} sub={sub} />
                        ))}
                    </ul>
                )}
            </Panel>
            <Panel
                title={strings.clients.packages}
                flush
                actions={
                    <Button
                        size="sm"
                        variant="link"
                        onPress={() => {
                            setSelling("package");
                        }}
                    >
                        {strings.clients.sellPackageLink}
                    </Button>
                }
            >
                {packages.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-muted">{strings.clients.noPackages}</p>
                ) : (
                    <ul className="divide-y divide-line-soft">
                        {packages.map((pkg) => (
                            <PackageLine key={pkg.id} pkg={pkg} />
                        ))}
                    </ul>
                )}
            </Panel>
            {selling === "package" ? <SellPackage clientId={clientId} onClose={close} /> : null}
            {selling === "subscription" ? (
                <StartSubscription clientId={clientId} onClose={close} />
            ) : null}
        </>
    );
}

/** A client's saved cards and bank accounts, with expiry, mandate state and the plans each pays. */
export function ClientWallet({ clientId }: { clientId: string }) {
    const wallet = useClientWallet(api, clientId);
    const add = useAddPaymentMethod(api, clientId, () => undefined);

    return (
        <div className="space-y-5">
            {wallet.load.state === "loading" ? (
                <Panel flush>
                    <Skeleton variant="row" count={3} label={s.loading} />
                </Panel>
            ) : null}
            {wallet.load.state === "error" ? (
                <Panel flush>
                    <LoadFailed
                        message={s.loadError}
                        onRetry={wallet.load.retry}
                        retrying={wallet.load.retrying}
                    />
                </Panel>
            ) : null}
            {wallet.load.hasData ? (
                <>
                    {wallet.expiring !== null ? (
                        <div
                            role="status"
                            className="flex items-start gap-2.5 rounded-md bg-warn-bg px-4 py-3 text-sm text-warn-fg"
                        >
                            <Icon name="alert" size={17} />
                            <span>{s.expiringBanner(wallet.expiring.label)}</span>
                        </div>
                    ) : null}
                    <Panel title={s.title} subtitle={s.subtitle} flush>
                        {wallet.methods.length === 0 ? (
                            <Empty icon="card" message={s.emptyTitle} body={s.empty} />
                        ) : (
                            <ul className="divide-y divide-line-soft">
                                {wallet.methods.map((m) => (
                                    <MethodRow key={m.row.id} m={m} wallet={wallet} />
                                ))}
                            </ul>
                        )}
                        <div className="border-t border-line bg-bg px-4 pb-4 pt-1">
                            <PaymentMethodForm flow={add} allowBank />
                            <p className="mt-3 text-xs text-muted">{s.defaultHint}</p>
                        </div>
                    </Panel>
                    {wallet.error !== null ? (
                        <Notice tone="danger" banner>
                            {wallet.error}
                        </Notice>
                    ) : null}
                    <Plans clientId={clientId} />
                </>
            ) : null}
        </div>
    );
}
