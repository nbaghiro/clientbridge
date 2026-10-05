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
import { theme } from "@clientbridge/tokens/theme";
import { type RouteProp, useRoute } from "@react-navigation/native";
import { type ComponentProps, useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { InboxButton } from "../components/InboxButton";
import { SellPackage, StartSubscription } from "../components/EntitlementSales";

import { DetailSection, DetailView } from "../ui/DetailView";
import { ListPage } from "../ui/ListPage";
import { Money } from "../ui/Money";
import { PaymentMethodForm } from "../ui/PaymentMethodForm";
import { StatusPill } from "../ui/StatusPill";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";
import type { TabParamList } from "../navigation";
import { Modal } from "../ui/Modal";

const c = theme.colors;

export function ClientsScreen() {
    const clients = useClients();
    const { q, setQ, filtered } = useSearch(clients, filterClients);
    const [adding, setAdding] = useState(false);
    const [openId, setOpenId] = useState<string | null>(null);
    const open = filtered.find((cl) => cl.id === openId) ?? null;
    const showValue = canManagePayments(useRole());
    const create = useRoute<RouteProp<TabParamList, "Clients">>().params?.create;
    useEffect(() => {
        if (create !== undefined) setAdding(true);
    }, [create]);

    return (
        <SafeAreaView style={styles.screen} edges={["top"]}>
            <ListPage
                title={strings.clients.title}
                summary={strings.clients.total(clients.length)}
                accessory={<InboxButton />}
                action={{
                    label: strings.clients.addShort,
                    onPress: () => {
                        setAdding(true);
                    },
                }}
                search={{
                    value: q,
                    onChange: setQ,
                    placeholder: strings.clients.searchPlaceholder,
                }}
                rows={filtered}
                rowKey={(cl) => cl.id}
                onRowPress={(cl) => {
                    setOpenId(cl.id);
                }}
                empty={q ? strings.clients.emptySearch : strings.clients.empty}
                renderRow={(cl) => <ClientRowView cl={cl} showValue={showValue} />}
            />

            <ClientDetailSheet
                client={open}
                onClose={() => {
                    setOpenId(null);
                }}
            />

            <AddClientModal
                visible={adding}
                onClose={() => {
                    setAdding(false);
                }}
            />
        </SafeAreaView>
    );
}

function ClientRowView({ cl, showValue }: { cl: ClientRow; showValue: boolean }) {
    return (
        <View style={styles.row}>
            <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials(cl.name)}</Text>
            </View>
            <View style={styles.rowMain}>
                <Text style={styles.rowName} numberOfLines={1}>
                    {cl.name}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                    {cl.email ?? cl.phone ?? strings.clients.dash}
                </Text>
            </View>
            <View style={styles.rowRight}>
                {showValue ? <Money cents={cl.lifetime_value_cents} strong /> : null}
                <StatusPill status={cl.status} intent={clientStatusIntent(cl.status)} />
            </View>
        </View>
    );
}

function ClientDetailSheet({ client, onClose }: { client: ClientRow | null; onClose: () => void }) {
    const canManage = canManagePayments(useRole());
    if (client === null) return null;

    return (
        <DetailView
            open
            title={client.name}
            subtitle={client.email ?? client.phone ?? strings.clients.dash}
            status={{ status: client.status, intent: clientStatusIntent(client.status) }}
            leading={
                <View style={styles.avatarLg}>
                    <Text style={styles.avatarText}>{initials(client.name)}</Text>
                </View>
            }
            onClose={onClose}
        >
            {canManage ? (
                <>
                    <PaymentMethodsSection clientId={client.id} />
                    <SubscriptionsSection clientId={client.id} />
                    <PackagesSection clientId={client.id} />
                </>
            ) : (
                <Text style={styles.note}>{strings.clients.manageRestricted}</Text>
            )}
        </DetailView>
    );
}

function SectionLink({ label, onPress }: { label: string; onPress: () => void }) {
    return (
        <Pressable onPress={onPress}>
            <Text style={styles.linkText}>{label}</Text>
        </Pressable>
    );
}

function PaymentMethodsSection({ clientId }: { clientId: string }) {
    const cards = useSavedCards(clientId);
    const flow = useAddPaymentMethod(api, clientId, () => undefined);

    return (
        <DetailSection title={strings.clients.paymentMethods}>
            {cards.length === 0 ? (
                <Text style={styles.note}>{strings.clients.noPaymentMethods}</Text>
            ) : (
                cards.map((card) => <CardRow key={card.id} card={card} />)
            )}
            <PaymentMethodForm flow={flow} allowBank={false} />
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
        Alert.alert(strings.clients.removeMethodTitle, strings.clients.removeMethodConfirm, [
            { text: strings.common.cancel, style: "cancel" },
            {
                text: strings.clients.remove,
                style: "destructive",
                onPress: () => {
                    run(() => detachCard(api, card.id), {
                        errorMessage: strings.clients.removeMethodError,
                    });
                },
            },
        ]);
    };

    return (
        <View style={styles.methodRow}>
            <View style={styles.methodMain}>
                <Text style={styles.methodLabel}>{savedCardLabel(card)}</Text>
                <View style={styles.methodTags}>
                    {isDefault ? (
                        <View style={styles.defaultTag}>
                            <Text style={styles.defaultTagText}>{strings.clients.defaultTag}</Text>
                        </View>
                    ) : null}
                    {isMandate(card) ? (
                        <StatusPill
                            status={card.mandate_status}
                            intent={mandateStatusIntent(card.mandate_status)}
                        />
                    ) : null}
                </View>
            </View>
            <View style={styles.methodActions}>
                {canBeDefault(card) ? (
                    <Pressable style={styles.miniBtn} disabled={busy} onPress={makeDefault}>
                        <Text style={styles.miniBtnText}>{strings.clients.makeDefault}</Text>
                    </Pressable>
                ) : null}
                <Pressable style={styles.miniBtn} disabled={busy} onPress={remove}>
                    <Text style={styles.miniBtnText}>{strings.clients.remove}</Text>
                </Pressable>
            </View>
            {error !== null ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
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
                        onPress={() => {
                            setStarting(true);
                        }}
                    />
                )
            }
        >
            {subs.length === 0 ? (
                <Text style={styles.note}>{strings.clients.noSubscriptions}</Text>
            ) : (
                subs.map((sub) => <SubscriptionRowItem key={sub.id} sub={sub} />)
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
        Alert.alert(
            strings.clients.cancelSubscriptionTitle,
            strings.clients.cancelSubscriptionConfirm,
            [
                { text: strings.clients.keep, style: "cancel" },
                {
                    text: strings.clients.cancelSubscriptionTitle,
                    style: "destructive",
                    onPress: () => {
                        run(() => cancelSubscription(api, sub.id), {
                            errorMessage: strings.clients.cancelSubscriptionError,
                        });
                    },
                },
            ],
        );
    };

    return (
        <View style={styles.methodRow}>
            <View style={styles.methodMain}>
                <Text style={styles.methodLabel}>
                    {sub.item_name ?? strings.clients.subscriptionFallback}
                </Text>
                {nextCharge !== null ? (
                    <Text style={styles.rowSub}>{strings.clients.nextCharge(nextCharge)}</Text>
                ) : null}
            </View>
            <View style={styles.methodActions}>
                <StatusPill status={sub.status} intent={subscriptionStatusIntent(sub.status)} />
                {isCancelable(sub.status) ? (
                    <Pressable style={styles.miniBtn} disabled={busy} onPress={cancel}>
                        <Text style={styles.miniBtnText}>
                            {busy ? strings.clients.busyEllipsis : strings.common.cancel}
                        </Text>
                    </Pressable>
                ) : null}
            </View>
            {error !== null ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
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
                        onPress={() => {
                            setSelling(true);
                        }}
                    />
                )
            }
        >
            {packages.length === 0 ? (
                <Text style={styles.note}>{strings.clients.noPackages}</Text>
            ) : (
                packages.map((pkg) => <PackageRowItem key={pkg.id} pkg={pkg} />)
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
        <View style={styles.methodRow}>
            <View style={styles.methodMain}>
                <Text style={styles.methodLabel}>
                    {pkg.item_name ?? strings.clients.packageFallback}
                </Text>
                <Text style={styles.rowSub}>
                    {strings.clients.sessionsLeftShort(sessionsRemaining(pkg), pkg.sessions_total)}
                </Text>
            </View>
            <View style={styles.methodActions}>
                <StatusPill status={pkg.status} intent={packageStatusIntent(pkg.status)} />
                {canConsume(pkg) ? (
                    <Pressable style={styles.miniBtn} disabled={busy} onPress={consume}>
                        <Text style={styles.miniBtnText}>
                            {busy ? strings.clients.busyEllipsis : strings.clients.consumeShort}
                        </Text>
                    </Pressable>
                ) : null}
            </View>
            {error !== null ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
    );
}

function ModalField({ label, ...props }: { label: string } & ComponentProps<typeof TextInput>) {
    return (
        <View style={styles.field}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <TextInput
                style={styles.fieldInput}
                placeholderTextColor={theme.colors.muted}
                {...props}
            />
        </View>
    );
}

function AddClientModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
    const form = useClientForm(api, onClose);

    return (
        <Modal open={visible} onClose={onClose}>
            <Text style={styles.modalTitle}>{strings.clients.addClientTitle}</Text>
            <ModalField
                label={strings.clients.nameLabel}
                value={form.name}
                onChangeText={form.setName}
                autoFocus
            />
            <ModalField
                label={strings.clients.emailLabel}
                value={form.email}
                onChangeText={form.setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
            />
            <ModalField
                label={strings.clients.phoneLabel}
                value={form.phone}
                onChangeText={form.setPhone}
            />
            {form.error ? <Text style={styles.error}>{form.error}</Text> : null}
            <View style={styles.modalActions}>
                <Pressable style={styles.cancel} onPress={onClose}>
                    <Text style={styles.cancelText}>{strings.common.cancel}</Text>
                </Pressable>
                <Pressable
                    style={styles.save}
                    onPress={() => {
                        form.submit();
                    }}
                    disabled={form.busy}
                >
                    {form.busy ? (
                        <ActivityIndicator color={theme.colors.accentInk} />
                    ) : (
                        <Text style={styles.saveText}>{strings.clients.addClient}</Text>
                    )}
                </Pressable>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    avatar: {
        width: 40,
        height: 40,
        borderRadius: theme.avatarRadius,
        backgroundColor: c.accentWeak,
        alignItems: "center",
        justifyContent: "center",
    },
    avatarLg: {
        width: 44,
        height: 44,
        borderRadius: theme.avatarRadius,
        backgroundColor: c.accentWeak,
        alignItems: "center",
        justifyContent: "center",
    },
    avatarText: { color: c.accent, fontWeight: "700", fontSize: 13 },
    rowMain: { flex: 1 },
    rowName: { color: c.ink, fontSize: 15, fontWeight: "600" },
    rowSub: { color: c.muted, fontSize: 13, marginTop: 1 },
    rowRight: { alignItems: "flex-end", gap: 4 },
    note: { color: c.muted, fontSize: 13, marginTop: 6, lineHeight: 18 },
    linkText: { color: c.accent, fontSize: 14, fontWeight: "600" },
    methodRow: {
        marginTop: 8,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.bg,
    },
    methodMain: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    methodLabel: { color: c.ink, fontSize: 14, fontWeight: "600", flexShrink: 1 },
    methodTags: { flexDirection: "row", alignItems: "center", gap: 6 },
    defaultTag: {
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
        backgroundColor: c.accentWeak,
    },
    defaultTagText: { color: c.accent, fontSize: 11, fontWeight: "600" },
    methodActions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
    miniBtn: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: theme.radius,
        borderColor: c.border,
        borderWidth: 1,
    },
    miniBtnText: { color: c.inkSoft, fontSize: 12, fontWeight: "600" },
    errorText: { color: c.danFg, fontSize: 13, marginTop: 8 },
    modal: {
        width: "100%",
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        padding: 22,
    },
    modalTitle: { color: c.ink, fontSize: 18, fontWeight: "700", marginBottom: 14 },
    field: { marginBottom: 12 },
    fieldLabel: { color: c.inkSoft, fontSize: 13, fontWeight: "600", marginBottom: 5 },
    fieldInput: {
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: c.ink,
        fontSize: 15,
        backgroundColor: c.bg,
    },
    error: { color: c.danFg, fontSize: 13, marginBottom: 4 },
    modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 8 },
    cancel: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: theme.radius },
    cancelText: { color: c.inkSoft, fontSize: 14, fontWeight: "600" },
    save: {
        backgroundColor: c.accent,
        borderRadius: theme.radius,
        paddingHorizontal: 16,
        paddingVertical: 10,
        minWidth: 88,
        alignItems: "center",
    },
    saveText: { color: c.accentInk, fontSize: 14, fontWeight: "700" },
});
