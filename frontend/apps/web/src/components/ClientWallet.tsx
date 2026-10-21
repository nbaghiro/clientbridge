import {
    type PackageRow,
    type SubscriptionRow,
    type WalletMethod,
    canConsume,
    cancelSubscription,
    usePackageConsumption,
    formatDate,
    isCancelable,
    packageStatusIntent,
    parseTimestamp,
    sessionsRemaining,
    strings,
    entitlementStatusLabel,
    subscriptionStatusIntent,
    useAddPaymentMethod,
    useAsyncAction,
    useClientPackages,
    useClientSubscriptions,
    useClientWallet,
    formatList,
    formatParts,
    useBusinessZone,
} from "@clientbridge/app-core";
import {
    ActionMenu,
    Badge,
    BrandMark,
    Button,
    confirm,
    DetailSection,
    IconButton,
    LoadFailed,
    Modal,
    Notice,
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
                        <Badge label={s.pays(formatList(m.pays, "unit"))} intent="neutral" />
                    ) : null}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    {m.status !== null ? (
                        <StatusPill status={m.status.label} intent={m.status.intent} />
                    ) : null}
                    {m.expiry !== null ? (
                        <span className={m.expiringSoon ? "font-medium text-warn-fg" : ""}>
                            {m.expiry}
                        </span>
                    ) : null}
                    <span>{formatParts([m.bankName, m.holder, m.added, m.note])}</span>
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
    const zone = useBusinessZone();
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
                                formatDate(parseTimestamp(sub.current_period_end), zone),
                            )}
                        </div>
                    ) : null}
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    <StatusPill
                        status={entitlementStatusLabel(sub.status)}
                        intent={subscriptionStatusIntent(sub.status)}
                    />
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
    const { busy, error, consume } = usePackageConsumption(api, pkg.id);
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
                    <StatusPill
                        status={entitlementStatusLabel(pkg.status)}
                        intent={packageStatusIntent(pkg.status)}
                    />
                    {canConsume(pkg) ? (
                        <Button variant="outline" size="sm" busy={busy} onPress={consume}>
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
            <DetailSection
                title={strings.clients.subscriptions}
                action={
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
                    <p className="text-sm text-muted">{strings.clients.noSubscriptions}</p>
                ) : (
                    <ul className="divide-y divide-line-soft rounded-md border border-line">
                        {subs.map((sub) => (
                            <SubscriptionLine key={sub.id} sub={sub} />
                        ))}
                    </ul>
                )}
            </DetailSection>
            <DetailSection
                title={strings.clients.packages}
                action={
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
                    <p className="text-sm text-muted">{strings.clients.noPackages}</p>
                ) : (
                    <ul className="divide-y divide-line-soft rounded-md border border-line">
                        {packages.map((pkg) => (
                            <PackageLine key={pkg.id} pkg={pkg} />
                        ))}
                    </ul>
                )}
            </DetailSection>
            {selling !== null ? (
                <Modal size="lg" onClose={close}>
                    {selling === "package" ? (
                        <SellPackage clientId={clientId} onClose={close} />
                    ) : (
                        <StartSubscription clientId={clientId} onClose={close} />
                    )}
                </Modal>
            ) : null}
        </>
    );
}

/** A client's saved cards and bank accounts, then their plans, inside the client's record panel. */
export function ClientWallet({ clientId }: { clientId: string }) {
    const wallet = useClientWallet(api, clientId);
    const add = useAddPaymentMethod(api, clientId, () => undefined);

    if (wallet.load.state === "loading")
        return <Skeleton variant="row" count={3} label={s.loading} />;
    if (wallet.load.state === "error")
        return (
            <LoadFailed
                message={s.loadError}
                onRetry={wallet.load.retry}
                retrying={wallet.load.retrying}
            />
        );
    return (
        <>
            {wallet.expiring !== null ? (
                <Notice tone="info" banner>
                    {s.expiringBanner(wallet.expiring.label)}
                </Notice>
            ) : null}
            <DetailSection title={s.title}>
                <p className="text-xs text-muted">{s.subtitle}</p>
                {wallet.methods.length === 0 ? (
                    <p className="text-sm text-muted">{s.empty}</p>
                ) : (
                    <ul className="divide-y divide-line-soft rounded-md border border-line">
                        {wallet.methods.map((m) => (
                            <MethodRow key={m.row.id} m={m} wallet={wallet} />
                        ))}
                    </ul>
                )}
                <PaymentMethodForm flow={add} allowBank />
                <p className="text-xs text-muted">{s.defaultHint}</p>
                {wallet.error !== null ? <Notice tone="danger">{wallet.error}</Notice> : null}
            </DetailSection>
            <Plans clientId={clientId} />
        </>
    );
}
