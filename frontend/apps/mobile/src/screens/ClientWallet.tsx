import {
    type PackageRow,
    type SubscriptionRow,
    type WalletMethod,
    canConsume,
    canManagePayments,
    cancelSubscription,
    usePackageConsumption,
    formatDate,
    isCancelable,
    packageStatusIntent,
    parseTimestamp,
    packageBalance,
    sessionsRemaining,
    entitlementStatusLabel,
    subscriptionStatusIntent,
    useAsyncAction,
    useClientPackages,
    useClientSubscriptions,
    strings,
    useAddPaymentMethod,
    useClientWallet,
    formatParts,
    useBusinessZone,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    ActionMenu,
    Badge,
    BrandMark,
    Button,
    confirm,
    Empty,
    Icon,
    ListRow,
    LoadFailed,
    Modal,
    Notice,
    Panel,
    PaymentMethodForm,
    SheetHeader,
    Skeleton,
    StatusPill,
} from "@clientbridge/ui";
import { type RouteProp, useRoute } from "@react-navigation/native";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";
import { useRole } from "../lib/auth";
import type { RootStackParamList } from "../navigation";

import { SellPackage, StartSubscription } from "../components/EntitlementSales";

const c = theme.colors;
const w = strings.clients.wallet;

export function ClientWalletScreen() {
    const { clientId } = useRoute<RouteProp<RootStackParamList, "ClientWallet">>().params;
    const manager = canManagePayments(useRole());
    const wallet = useClientWallet(api, clientId);
    const [adding, setAdding] = useState(false);
    const add = useAddPaymentMethod(api, clientId, () => {
        setAdding(false);
    });
    const [menuFor, setMenuFor] = useState<WalletMethod | null>(null);
    const askRemove = (m: WalletMethod): void => {
        confirm({
            title: w.removeTitle(m.label),
            message: wallet.removeMessage(m),
            confirmLabel: w.removeConfirm,
            destructive: true,
        })
            .then((ok) => {
                if (ok) wallet.remove(m.row.id);
            })
            .catch(() => undefined);
    };
    if (!manager) {
        return (
            <View style={styles.screen}>
                <View style={styles.body}>
                    <Notice tone="info" banner>
                        {w.onlyManagers}
                    </Notice>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.screen}>
            <ScrollView contentContainerStyle={styles.body}>
                {wallet.load.state === "loading" ? (
                    <Skeleton variant="row" count={3} label={w.loading} />
                ) : null}
                {wallet.load.state === "error" ? (
                    <LoadFailed
                        message={w.loadError}
                        onRetry={wallet.load.retry}
                        retrying={wallet.load.retrying}
                    />
                ) : null}
                {wallet.expiring !== null ? (
                    <View style={styles.warn}>
                        <Icon name="alert" size={16} color={c.warnFg} />
                        <Text style={styles.warnText}>
                            {w.expiringBanner(wallet.expiring.label)}
                        </Text>
                    </View>
                ) : null}
                {wallet.load.hasData ? (
                    <Panel flush>
                        {wallet.methods.length === 0 ? (
                            <Empty icon="card" message={w.emptyTitle} body={w.empty} />
                        ) : null}
                        {wallet.methods.map((m) => (
                            <ListRow
                                key={m.row.id}
                                leading={<BrandMark method={m.row.method} brand={m.row.brand} />}
                                title={m.label}
                                detail={formatParts([m.expiry, m.bankName, m.added, m.note])}
                                meta={
                                    m.isDefault ? (
                                        <Badge label={w.default} intent="accent" />
                                    ) : m.status !== null ? (
                                        <StatusPill
                                            status={m.status.label}
                                            intent={m.status.intent}
                                        />
                                    ) : undefined
                                }
                                label={w.more(m.label)}
                                onPress={() => {
                                    setMenuFor(m);
                                }}
                            />
                        ))}
                    </Panel>
                ) : null}
                <Text style={styles.hint}>{w.defaultHint}</Text>
                {wallet.load.hasData ? (
                    <View style={styles.group}>
                        <Button
                            full
                            variant="outline"
                            icon="plus"
                            onPress={() => {
                                setAdding(true);
                                add.start("card");
                            }}
                        >
                            {w.addCard}
                        </Button>
                    </View>
                ) : null}
                {wallet.load.hasData ? (
                    <Button
                        full
                        variant="outline"
                        icon="plus"
                        onPress={() => {
                            setAdding(true);
                            add.start("bank");
                        }}
                    >
                        {strings.clients.addBankWeb}
                    </Button>
                ) : null}
                {wallet.error !== null ? (
                    <Notice tone="danger" banner>
                        {wallet.error}
                    </Notice>
                ) : null}
                {wallet.load.hasData ? <Plans clientId={clientId} /> : null}
            </ScrollView>
            <ActionMenu
                open={menuFor !== null}
                onClose={() => {
                    setMenuFor(null);
                }}
                title={menuFor?.label}
                items={[
                    ...(menuFor?.canBeDefault === true
                        ? [
                              {
                                  key: "default",
                                  label: w.makeDefault,
                                  hint: w.defaultHint,
                                  icon: "check" as const,
                              },
                          ]
                        : []),
                    {
                        key: "remove",
                        label: w.remove,
                        hint: menuFor === null ? undefined : wallet.removeMessage(menuFor),
                        icon: "trash" as const,
                    },
                ]}
                onSelect={(k) => {
                    const m = menuFor;
                    setMenuFor(null);
                    if (m === null) return;
                    if (k === "default") wallet.makeDefault(m.row.id);
                    else askRemove(m);
                }}
            />
            {adding ? (
                <Modal
                    open
                    onClose={() => {
                        setAdding(false);
                        add.cancel();
                    }}
                >
                    <SheetHeader
                        style={styles.sheetHead}
                        title={add.kind === "bank" ? strings.clients.addBankWeb : w.addCard}
                    />
                    <PaymentMethodForm flow={add} allowBank />
                </Modal>
            ) : null}
        </View>
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
        <View style={styles.planRow}>
            <ListRow
                density="compact"
                title={sub.item_name ?? strings.clients.subscriptionFallback}
                detail={
                    sub.current_period_end === null
                        ? undefined
                        : strings.clients.nextCharge(
                              formatDate(parseTimestamp(sub.current_period_end), zone),
                          )
                }
                meta={
                    <StatusPill
                        status={entitlementStatusLabel(sub.status)}
                        intent={subscriptionStatusIntent(sub.status)}
                    />
                }
                trailing={
                    isCancelable(sub.status) ? (
                        <Button variant="outline" size="sm" busy={busy} onPress={cancel}>
                            {strings.common.cancel}
                        </Button>
                    ) : undefined
                }
            />
            {error !== null ? <Notice tone="danger">{error}</Notice> : null}
        </View>
    );
}

function PackageLine({ pkg }: { pkg: PackageRow }) {
    const { busy, error, consume } = usePackageConsumption(api, pkg.id);
    return (
        <View style={styles.planRow}>
            <ListRow
                density="compact"
                title={pkg.item_name ?? strings.clients.packageFallback}
                detail={packageBalance(
                    pkg.subject_name,
                    strings.clients.sessionsLeftShort(sessionsRemaining(pkg), pkg.sessions_total),
                )}
                meta={
                    <StatusPill
                        status={entitlementStatusLabel(pkg.status)}
                        intent={packageStatusIntent(pkg.status)}
                    />
                }
                trailing={
                    canConsume(pkg) ? (
                        <Button variant="outline" size="sm" busy={busy} onPress={consume}>
                            {strings.clients.consumeShort}
                        </Button>
                    ) : undefined
                }
            />
            {error !== null ? <Notice tone="danger">{error}</Notice> : null}
        </View>
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
                    <Text style={styles.empty}>{strings.clients.noSubscriptions}</Text>
                ) : (
                    subs.map((sub) => <SubscriptionLine key={sub.id} sub={sub} />)
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
                    <Text style={styles.empty}>{strings.clients.noPackages}</Text>
                ) : (
                    packages.map((pkg) => <PackageLine key={pkg.id} pkg={pkg} />)
                )}
            </Panel>
            {selling === "package" ? <SellPackage clientId={clientId} onClose={close} /> : null}
            {selling === "subscription" ? (
                <StartSubscription clientId={clientId} onClose={close} />
            ) : null}
        </>
    );
}

const styles = StyleSheet.create({
    planRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.borderSoft },
    empty: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 13, padding: 14 },
    screen: { flex: 1, backgroundColor: c.bg },
    body: { padding: 16, paddingBottom: 32, gap: 12 },
    group: { marginTop: 6 },
    warn: {
        flexDirection: "row",
        gap: 8,
        backgroundColor: c.warnBg,
        borderRadius: theme.radius,
        padding: 12,
    },
    warnText: {
        flex: 1,
        color: c.warnFg,
        fontFamily: theme.fonts.ui,
        fontSize: 13,
        lineHeight: 18,
    },
    sheetHead: { marginBottom: 12 },
    hint: {
        color: c.muted,
        fontFamily: theme.fonts.ui,
        fontSize: 12,
        lineHeight: 17,
        marginHorizontal: 4,
    },
});
