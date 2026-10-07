import {
    type ClientHistoryFilter,
    type PackageRow,
    type PetCard,
    type SubjectRow,
    type SubscriptionRow,
    type WalletMethod,
    canConsume,
    canManagePayments,
    cancelSubscription,
    consumeSession,
    formatDate,
    isCancelable,
    packageStatusIntent,
    parseTimestamp,
    sessionsRemaining,
    subscriptionStatusIntent,
    useAsyncAction,
    useClientPackages,
    useClientSubscriptions,
    formatRelativeTime,
    relativeDay,
    strings,
    toTimeline,
    useAddPaymentMethod,
    useClientHistory,
    useClientPets,
    useClientWallet,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    ActionMenu,
    ActivityTimeline,
    Avatar,
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
    Skeleton,
    StatusPill,
    Tabs,
} from "@clientbridge/ui";
import { type RouteProp, useRoute } from "@react-navigation/native";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";
import { useRole, useViewer } from "../lib/auth";
import type { RootStackParamList } from "../navigation";
import { NoteSheet, PetSheet } from "./ClientSheets";
import { SellPackage, StartSubscription } from "./EntitlementSales";

const c = theme.colors;
const h = strings.clients.history;
const p = strings.clients.pets;
const w = strings.clients.wallet;

/** One client's history: pinned notes, a note box, and the timeline by month with filters. */
export function ClientHistoryScreen() {
    const { clientId } = useRoute<RouteProp<RootStackParamList, "ClientHistory">>().params;
    const viewer = useViewer();
    const hist = useClientHistory(clientId, viewer?.staffId ?? null);
    const [composing, setComposing] = useState(false);
    const now = new Date();

    return (
        <View style={styles.screen}>
            {hist.load.ready ? (
                <Tabs<ClientHistoryFilter>
                    variant="pill"
                    items={hist.filters.map((f) => ({
                        key: f.key,
                        label: h.withCount(f.label, f.hint),
                    }))}
                    active={hist.filter}
                    onSelect={hist.setFilter}
                />
            ) : null}
            <ScrollView contentContainerStyle={styles.body}>
                {hist.load.state === "loading" ? (
                    <Skeleton variant="row" count={5} label={h.loading} />
                ) : null}
                {hist.load.state === "error" ? (
                    <LoadFailed
                        message={h.loadError}
                        onRetry={hist.load.retry}
                        retrying={hist.load.retrying}
                    />
                ) : null}
                {hist.pinned.map((n) => (
                    <View key={n.id} style={styles.pinned}>
                        <View style={styles.row}>
                            <Icon name="alert" size={14} color={c.warnFg} />
                            <Text style={styles.pinnedTitle}>{h.headsUp}</Text>
                        </View>
                        <Text style={styles.pinnedBody}>{n.body}</Text>
                        <Text style={styles.pinnedMeta}>
                            {h.by(n.author, formatRelativeTime(n.at.toISOString(), now))}
                        </Text>
                    </View>
                ))}
                {hist.load.hasData ? (
                    <Button
                        full
                        variant="outline"
                        icon="edit"
                        onPress={() => {
                            setComposing(true);
                        }}
                    >
                        {h.saveNote}
                    </Button>
                ) : null}
                {hist.filter === "all" && hist.upcoming.length > 0 ? (
                    <View style={styles.group}>
                        <Text style={styles.groupLabel}>{h.upcoming}</Text>
                        <View style={[styles.card, styles.cardAccent]}>
                            <ActivityTimeline entries={hist.upcoming.map(toTimeline)} />
                        </View>
                    </View>
                ) : null}
                {hist.load.state === "empty" ? (
                    <Empty icon="history" message={h.emptyTitle} body={h.empty} />
                ) : null}
                {hist.load.ready && hist.groups.length === 0 ? (
                    <Empty message={hist.total === 0 ? h.empty : h.emptyFilter} />
                ) : null}
                {hist.groups.map((g) => (
                    <View key={g.key} style={styles.group}>
                        <Text style={styles.groupLabel}>{g.label}</Text>
                        <View style={styles.card}>
                            <ActivityTimeline entries={g.entries.map(toTimeline)} />
                        </View>
                    </View>
                ))}
                {hist.hasOlder ? (
                    <View style={styles.group}>
                        <Button full variant="outline" onPress={hist.showOlder}>
                            {h.loadOlder}
                        </Button>
                    </View>
                ) : null}
            </ScrollView>
            {composing ? (
                <NoteSheet
                    clientId={clientId}
                    pets={hist.pets}
                    onClose={() => {
                        setComposing(false);
                    }}
                />
            ) : null}
        </View>
    );
}

function PetCardView({ card, onPress }: { card: PetCard; onPress: () => void }) {
    const alerts = card.alerts.filter((a) => a.key !== "temp");
    return (
        <View style={styles.petCard}>
            <ListRow
                leading={<Avatar name={card.pet.name} size="lg" />}
                title={card.pet.name}
                detail={card.line}
                meta={
                    card.temperament !== null ? (
                        <Badge
                            label={card.temperament}
                            intent={
                                card.alerts.some((a) => a.key === "temp") ? "warning" : "neutral"
                            }
                        />
                    ) : undefined
                }
                label={p.editNamed(card.pet.name)}
                onPress={onPress}
            />
            {alerts.map((a) => (
                <View
                    key={a.key}
                    style={[
                        styles.alert,
                        { backgroundColor: a.intent === "danger" ? c.danBg : c.warnBg },
                    ]}
                >
                    <Icon
                        name="alert"
                        size={14}
                        color={a.intent === "danger" ? c.danFg : c.warnFg}
                    />
                    <Text
                        style={[
                            styles.alertText,
                            { color: a.intent === "danger" ? c.danFg : c.warnFg },
                        ]}
                    >
                        {a.label}
                    </Text>
                </View>
            ))}
            <View style={styles.stats}>
                <Stat label={p.visits} value={String(card.visits)} />
                <Stat
                    label={p.lastVisit}
                    value={
                        card.lastVisit === null ? strings.clients.dash : formatDate(card.lastVisit)
                    }
                />
                <Stat
                    label={p.nextVisit}
                    value={card.next === null ? p.nothingBooked : relativeDay(card.next)}
                />
            </View>
        </View>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <View style={styles.stat}>
            <Text style={styles.statLabel}>{label}</Text>
            <Text style={styles.statValue} numberOfLines={1}>
                {value}
            </Text>
        </View>
    );
}

/** A client's pets as cards; tapping one opens its sheet. */
export function ClientPetsScreen() {
    const { clientId } = useRoute<RouteProp<RootStackParamList, "ClientPets">>().params;
    const { load, cards } = useClientPets(clientId);
    const [editing, setEditing] = useState<{ pet: SubjectRow | null } | null>(null);
    return (
        <View style={styles.screen}>
            <ScrollView contentContainerStyle={styles.body}>
                {load.state === "loading" ? (
                    <Skeleton variant="row" count={3} label={p.loading} />
                ) : null}
                {load.state === "error" ? (
                    <LoadFailed
                        message={p.loadError}
                        onRetry={load.retry}
                        retrying={load.retrying}
                    />
                ) : null}
                {load.hasData && cards.length === 0 ? (
                    <Empty icon="paw" message={p.noPetsTitle} body={p.noPetsBody} />
                ) : null}
                {cards.map((card) => (
                    <PetCardView
                        key={card.pet.id}
                        card={card}
                        onPress={() => {
                            setEditing({ pet: card.pet });
                        }}
                    />
                ))}
                {load.hasData ? (
                    <Button
                        full
                        variant="outline"
                        icon="paw"
                        onPress={() => {
                            setEditing({ pet: null });
                        }}
                    >
                        {p.addPet}
                    </Button>
                ) : null}
            </ScrollView>
            {editing !== null ? (
                <PetSheet
                    key={editing.pet?.id ?? "new"}
                    clientId={clientId}
                    pet={editing.pet}
                    onClose={() => {
                        setEditing(null);
                    }}
                />
            ) : null}
        </View>
    );
}

/** A client's saved cards and bank accounts; a card is added here, a bank account on the web. */
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
                    <View style={styles.list}>
                        {wallet.methods.length === 0 ? (
                            <Empty icon="card" message={w.emptyTitle} body={w.empty} />
                        ) : null}
                        {wallet.methods.map((m) => (
                            <ListRow
                                key={m.row.id}
                                leading={<BrandMark method={m.row.method} brand={m.row.brand} />}
                                title={m.label}
                                detail={[m.expiry, m.bankName, m.added, m.note]
                                    .filter((x) => x !== null && x !== "")
                                    .join(" · ")}
                                meta={
                                    m.isDefault ? (
                                        <Badge label={w.default} intent="accent" />
                                    ) : m.status !== null ? (
                                        <StatusPill
                                            status={m.status.label}
                                            intent={m.status.intent}
                                            asWritten
                                        />
                                    ) : undefined
                                }
                                label={w.more(m.label)}
                                onPress={() => {
                                    setMenuFor(m);
                                }}
                            />
                        ))}
                    </View>
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
                <Text style={styles.hint}>{w.bankOnWebOnly}</Text>
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
                    <Text style={styles.sheetTitle}>{w.addCard}</Text>
                    <PaymentMethodForm flow={add} allowBank={false} />
                </Modal>
            ) : null}
        </View>
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
        <View style={styles.planRow}>
            <ListRow
                density="compact"
                title={sub.item_name ?? strings.clients.subscriptionFallback}
                detail={
                    sub.current_period_end === null
                        ? undefined
                        : strings.clients.nextCharge(
                              formatDate(parseTimestamp(sub.current_period_end)),
                          )
                }
                meta={
                    <StatusPill status={sub.status} intent={subscriptionStatusIntent(sub.status)} />
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
    const { busy, error, run } = useAsyncAction();
    return (
        <View style={styles.planRow}>
            <ListRow
                density="compact"
                title={pkg.item_name ?? strings.clients.packageFallback}
                detail={strings.clients.sessionsLeftShort(
                    sessionsRemaining(pkg),
                    pkg.sessions_total,
                )}
                meta={<StatusPill status={pkg.status} intent={packageStatusIntent(pkg.status)} />}
                trailing={
                    canConsume(pkg) ? (
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
    empty: { color: c.muted, fontSize: 13, padding: 14 },
    screen: { flex: 1, backgroundColor: c.bg },
    body: { padding: 16, paddingBottom: 32, gap: 12 },
    row: { flexDirection: "row", alignItems: "center", gap: 6 },
    pinned: { backgroundColor: c.warnBg, borderRadius: theme.radius, padding: 12 },
    pinnedTitle: {
        color: c.warnFg,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.5,
        textTransform: "uppercase",
    },
    pinnedBody: { color: c.ink, fontSize: 14, lineHeight: 20, marginTop: 6 },
    pinnedMeta: { color: c.warnFg, fontSize: 12, marginTop: 4 },
    group: { marginTop: 6 },
    groupLabel: {
        color: c.muted,
        fontSize: 12,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 8,
    },
    card: {
        backgroundColor: c.surface,
        borderRadius: theme.radius + 2,
        borderWidth: 1,
        borderColor: c.border,
        padding: 14,
    },
    cardAccent: { borderColor: c.accentLine },
    petCard: {
        backgroundColor: c.surface,
        borderRadius: theme.radius + 2,
        borderWidth: 1,
        borderColor: c.border,
        overflow: "hidden",
    },
    alert: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginHorizontal: 14,
        marginBottom: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: theme.radius,
    },
    alertText: { fontSize: 12, fontWeight: "600", flexShrink: 1 },
    stats: {
        flexDirection: "row",
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.border,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    stat: { flex: 1, minWidth: 0 },
    statLabel: { color: c.muted, fontSize: 11 },
    statValue: { color: c.ink, fontSize: 13, fontWeight: "600", marginTop: 2 },
    warn: {
        flexDirection: "row",
        gap: 8,
        backgroundColor: c.warnBg,
        borderRadius: theme.radius,
        padding: 12,
    },
    warnText: { flex: 1, color: c.warnFg, fontSize: 13, lineHeight: 18 },
    list: {
        backgroundColor: c.surface,
        borderRadius: theme.radius + 2,
        borderWidth: 1,
        borderColor: c.border,
        overflow: "hidden",
    },
    hint: { color: c.muted, fontSize: 12, lineHeight: 17, marginHorizontal: 4 },
    sheetTitle: { color: c.ink, fontSize: 17, fontWeight: "700", marginBottom: 12 },
});
