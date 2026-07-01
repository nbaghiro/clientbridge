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
    useSubscriptionForm,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { type ComponentProps, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { IconPlus, IconSearch } from "../components/icons";
import { CardPaymentConfirm, CardSetupConfirm } from "../components/stripe";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";

const c = theme.colors;

export function ClientsScreen() {
    const clients = useClients();
    const { q, setQ, filtered } = useSearch(clients, filterClients);
    const [adding, setAdding] = useState(false);
    const [openId, setOpenId] = useState<string | null>(null);
    const open = filtered.find((cl) => cl.id === openId) ?? null;

    return (
        <SafeAreaView style={styles.screen} edges={["top"]}>
            <View style={styles.header}>
                <View>
                    <Text style={styles.title}>{strings.clients.title}</Text>
                    <Text style={styles.count}>{strings.clients.total(clients.length)}</Text>
                </View>
                <Pressable
                    style={styles.add}
                    onPress={() => {
                        setAdding(true);
                    }}
                >
                    <IconPlus size={16} color={theme.colors.accentInk} />
                    <Text style={styles.addText}>{strings.clients.addShort}</Text>
                </Pressable>
            </View>

            <View style={styles.searchWrap}>
                <IconSearch size={16} color={theme.colors.muted} />
                <TextInput
                    style={styles.search}
                    value={q}
                    onChangeText={setQ}
                    placeholder={strings.clients.searchPlaceholder}
                    placeholderTextColor={theme.colors.muted}
                    autoCapitalize="none"
                />
            </View>

            <FlatList
                data={filtered}
                keyExtractor={(cl) => cl.id}
                contentContainerStyle={styles.list}
                renderItem={({ item }) => (
                    <ClientRowView
                        cl={item}
                        onPress={() => {
                            setOpenId(item.id);
                        }}
                    />
                )}
                ListEmptyComponent={
                    <Text style={styles.empty}>
                        {q ? strings.clients.emptySearch : strings.clients.empty}
                    </Text>
                }
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

function ClientRowView({ cl, onPress }: { cl: ClientRow; onPress: () => void }) {
    return (
        <Pressable style={styles.row} onPress={onPress}>
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
                <Text style={styles.rowValue}>{formatMoney(cl.lifetime_value_cents)}</Text>
                <StatusBadge status={cl.status} intent={clientStatusIntent(cl.status)} />
            </View>
        </Pressable>
    );
}

function ClientDetailSheet({ client, onClose }: { client: ClientRow | null; onClose: () => void }) {
    const canManage = canManagePayments(useRole());

    return (
        <Modal visible={client !== null} transparent animationType="slide" onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <View style={styles.sheet}>
                    {client !== null ? (
                        <>
                            <View style={styles.sheetHead}>
                                <View style={styles.sheetHeadMain}>
                                    <View style={styles.avatarLg}>
                                        <Text style={styles.avatarText}>
                                            {initials(client.name)}
                                        </Text>
                                    </View>
                                    <View style={styles.sheetHeadText}>
                                        <Text style={styles.sheetTitle} numberOfLines={1}>
                                            {client.name}
                                        </Text>
                                        <Text style={styles.rowSub} numberOfLines={1}>
                                            {client.email ?? client.phone ?? strings.clients.dash}
                                        </Text>
                                    </View>
                                </View>
                                <StatusBadge
                                    status={client.status}
                                    intent={clientStatusIntent(client.status)}
                                />
                            </View>
                            <ScrollView style={styles.sheetBody}>
                                {canManage ? (
                                    <>
                                        <PaymentMethodsSection clientId={client.id} />
                                        <SubscriptionsSection clientId={client.id} />
                                        <PackagesSection clientId={client.id} />
                                    </>
                                ) : (
                                    <Text style={styles.note}>
                                        {strings.clients.manageRestricted}
                                    </Text>
                                )}
                            </ScrollView>
                            <View style={styles.actions}>
                                <Pressable style={styles.cancel} onPress={onClose}>
                                    <Text style={styles.cancelText}>{strings.common.close}</Text>
                                </Pressable>
                            </View>
                        </>
                    ) : null}
                </View>
            </View>
        </Modal>
    );
}

function PaymentMethodsSection({ clientId }: { clientId: string }) {
    const cards = useSavedCards(clientId);
    const flow = useAddPaymentMethod(api, clientId, () => undefined);

    return (
        <View style={styles.section}>
            <Text style={styles.sectionLabel}>{strings.clients.paymentMethods}</Text>
            {cards.length === 0 ? (
                <Text style={styles.note}>{strings.clients.noPaymentMethods}</Text>
            ) : (
                cards.map((card) => <CardRow key={card.id} card={card} />)
            )}
            <AddMethodPanel flow={flow} />
            {flow.error !== null ? <Text style={styles.errorText}>{flow.error}</Text> : null}
        </View>
    );
}

function AddMethodPanel({ flow }: { flow: AddPaymentMethod }) {
    const intent = flow.intent;
    if (intent !== null) {
        // Card setup confirms with the SDK CardField; bank (PAD/ACSS) needs an ACSS mandate flow
        // beyond a CardField, so it keeps the placeholder until that follow lands.
        if (flow.kind === "card") return <CardSetupConfirm flow={flow} />;
        return (
            <View style={styles.setupBox}>
                <Text style={styles.setupTitle}>{strings.clients.authorizePad}</Text>
                <Text style={styles.setupNote}>{strings.clients.padNotWired}</Text>
                <Text style={styles.setupSecret} numberOfLines={1}>
                    {strings.clients.setupIntentLabel} {intent.client_secret}
                </Text>
                <View style={styles.setupActions}>
                    <Pressable style={styles.cancel} onPress={flow.cancel}>
                        <Text style={styles.cancelText}>{strings.common.cancel}</Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.addRow}>
            <Pressable
                style={styles.outlineBtn}
                disabled={flow.busy}
                onPress={() => {
                    flow.start("card");
                }}
            >
                {flow.busy && flow.kind === "card" ? (
                    <ActivityIndicator color={c.inkSoft} />
                ) : (
                    <Text style={styles.outlineBtnText}>{strings.clients.addCard}</Text>
                )}
            </Pressable>
            <Pressable
                style={styles.outlineBtn}
                disabled={flow.busy}
                onPress={() => {
                    flow.start("bank");
                }}
            >
                {flow.busy && flow.kind === "bank" ? (
                    <ActivityIndicator color={c.inkSoft} />
                ) : (
                    <Text style={styles.outlineBtnText}>{strings.clients.addBankShort}</Text>
                )}
            </Pressable>
        </View>
    );
}

function CardRow({ card }: { card: SavedCardRow }) {
    const { busy, error, run } = useAsyncAction();
    const isDefault = card.is_default === 1;

    const makeDefault = (): void => {
        void run(() => setDefaultCard(api, card.id), {
            errorMessage: strings.clients.setDefaultError,
        });
    };

    const remove = (): void => {
        Alert.alert(strings.clients.removeMethodTitle, strings.clients.removeMethodConfirm, [
            { text: strings.common.cancel, style: "cancel" },
            {
                text: strings.clients.remove,
                style: "destructive",
                onPress: () =>
                    void run(() => detachCard(api, card.id), {
                        errorMessage: strings.clients.removeMethodError,
                    }),
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
                        <StatusBadge
                            status={card.mandate_status}
                            intent={mandateStatusIntent(card.mandate_status)}
                        />
                    ) : null}
                </View>
            </View>
            <View style={styles.methodActions}>
                {!isDefault ? (
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
    const cards = useSavedCards(clientId);
    const items = useCatalogItems();
    const plans = subscriptionPlans(items);
    const [starting, setStarting] = useState(false);

    return (
        <View style={styles.section}>
            <View style={styles.sectionHead}>
                <Text style={styles.sectionLabel}>{strings.clients.subscriptions}</Text>
                {!starting ? (
                    <Pressable
                        onPress={() => {
                            setStarting(true);
                        }}
                    >
                        <Text style={styles.linkText}>{strings.clients.startSubscriptionLink}</Text>
                    </Pressable>
                ) : null}
            </View>
            {subs.length === 0 ? (
                <Text style={styles.note}>{strings.clients.noSubscriptions}</Text>
            ) : (
                subs.map((sub) => <SubscriptionRowItem key={sub.id} sub={sub} />)
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
        </View>
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
                    onPress: () =>
                        void run(() => cancelSubscription(api, sub.id), {
                            errorMessage: strings.clients.cancelSubscriptionError,
                        }),
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
                <StatusBadge status={sub.status} intent={subscriptionStatusIntent(sub.status)} />
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
        <View style={styles.setupBox}>
            <Text style={styles.fieldLabel}>{strings.clients.planLabel}</Text>
            {plans.length === 0 ? (
                <Text style={styles.note}>{strings.clients.addSubscriptionItemFirst}</Text>
            ) : (
                <View style={styles.chipWrap}>
                    {plans.map((p) => (
                        <Pressable
                            key={p.id}
                            style={[styles.chip, form.itemId === p.id && styles.chipOn]}
                            onPress={() => {
                                form.setItemId(p.id);
                            }}
                        >
                            <Text
                                style={[styles.chipText, form.itemId === p.id && styles.chipTextOn]}
                            >
                                {p.name} · {formatMoney(p.price_cents)}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            )}

            <Text style={[styles.fieldLabel, styles.fieldSpace]}>
                {strings.clients.paymentMethodLabel}
            </Text>
            {cards.length === 0 ? (
                <Text style={styles.note}>{strings.clients.addPaymentMethodFirst}</Text>
            ) : (
                <View style={styles.chipWrap}>
                    {cards.map((card) => (
                        <Pressable
                            key={card.id}
                            style={[styles.chip, form.paymentMethodId === card.id && styles.chipOn]}
                            onPress={() => {
                                form.setPaymentMethodId(card.id);
                            }}
                        >
                            <Text
                                style={[
                                    styles.chipText,
                                    form.paymentMethodId === card.id && styles.chipTextOn,
                                ]}
                            >
                                {savedCardLabel(card)}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            )}

            {form.error !== null ? <Text style={styles.errorText}>{form.error}</Text> : null}
            <View style={styles.setupActions}>
                <Pressable style={styles.cancel} onPress={onClose}>
                    <Text style={styles.cancelText}>{strings.common.cancel}</Text>
                </Pressable>
                <Pressable style={styles.save} disabled={form.busy} onPress={form.submit}>
                    {form.busy ? (
                        <ActivityIndicator color={c.accentInk} />
                    ) : (
                        <Text style={styles.saveText}>{strings.clients.startShort}</Text>
                    )}
                </Pressable>
            </View>
        </View>
    );
}

function PackagesSection({ clientId }: { clientId: string }) {
    const packages = useClientPackages(clientId);
    const cards = useSavedCards(clientId);
    const items = useCatalogItems();
    const offerings = packageOfferings(items);
    const [selling, setSelling] = useState(false);

    return (
        <View style={styles.section}>
            <View style={styles.sectionHead}>
                <Text style={styles.sectionLabel}>{strings.clients.packages}</Text>
                {!selling ? (
                    <Pressable
                        onPress={() => {
                            setSelling(true);
                        }}
                    >
                        <Text style={styles.linkText}>{strings.clients.sellPackageLink}</Text>
                    </Pressable>
                ) : null}
            </View>
            {packages.length === 0 ? (
                <Text style={styles.note}>{strings.clients.noPackages}</Text>
            ) : (
                packages.map((pkg) => <PackageRowItem key={pkg.id} pkg={pkg} />)
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
        </View>
    );
}

function PackageRowItem({ pkg }: { pkg: PackageRow }) {
    const { busy, error, run } = useAsyncAction();

    const consume = (): void => {
        void run(() => consumeSession(api, pkg.id), {
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
                <StatusBadge status={pkg.status} intent={packageStatusIntent(pkg.status)} />
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

    if (form.clientSecret !== null) {
        return (
            <CardPaymentConfirm
                clientSecret={form.clientSecret}
                onCancel={form.cancel}
                onConfirmed={form.complete}
            />
        );
    }

    return (
        <View style={styles.setupBox}>
            <Text style={styles.fieldLabel}>{strings.clients.packageLabel}</Text>
            {offerings.length === 0 ? (
                <Text style={styles.note}>{strings.clients.addPackageItemFirst}</Text>
            ) : (
                <View style={styles.chipWrap}>
                    {offerings.map((o) => (
                        <Pressable
                            key={o.id}
                            style={[styles.chip, form.itemId === o.id && styles.chipOn]}
                            onPress={() => {
                                form.setItemId(o.id);
                            }}
                        >
                            <Text
                                style={[styles.chipText, form.itemId === o.id && styles.chipTextOn]}
                            >
                                {o.name} · {formatMoney(o.price_cents)}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            )}

            <Text style={[styles.fieldLabel, styles.fieldSpace]}>
                {strings.clients.paymentLabel}
            </Text>
            <View style={styles.chipWrap}>
                <Pressable
                    style={[styles.chip, form.paymentMethodId === "" && styles.chipOn]}
                    onPress={() => {
                        form.setPaymentMethodId("");
                    }}
                >
                    <Text
                        style={[styles.chipText, form.paymentMethodId === "" && styles.chipTextOn]}
                    >
                        {strings.clients.newCard}
                    </Text>
                </Pressable>
                {cards.map((card) => (
                    <Pressable
                        key={card.id}
                        style={[styles.chip, form.paymentMethodId === card.id && styles.chipOn]}
                        onPress={() => {
                            form.setPaymentMethodId(card.id);
                        }}
                    >
                        <Text
                            style={[
                                styles.chipText,
                                form.paymentMethodId === card.id && styles.chipTextOn,
                            ]}
                        >
                            {savedCardLabel(card)}
                        </Text>
                    </Pressable>
                ))}
            </View>

            {form.error !== null ? <Text style={styles.errorText}>{form.error}</Text> : null}
            <View style={styles.setupActions}>
                <Pressable style={styles.cancel} onPress={onClose}>
                    <Text style={styles.cancelText}>{strings.common.cancel}</Text>
                </Pressable>
                <Pressable style={styles.save} disabled={form.busy} onPress={form.submit}>
                    {form.busy ? (
                        <ActivityIndicator color={c.accentInk} />
                    ) : (
                        <Text style={styles.saveText}>{strings.clients.sellShort}</Text>
                    )}
                </Pressable>
            </View>
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
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.modalBackdrop}>
                <View style={styles.modal}>
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
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 12,
    },
    title: { color: c.ink, fontSize: 26, fontWeight: "700", letterSpacing: -0.4 },
    count: { color: c.muted, fontSize: 13, marginTop: 2 },
    add: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: c.accent,
        borderRadius: theme.radius,
        paddingHorizontal: 13,
        paddingVertical: 9,
    },
    addText: { color: c.accentInk, fontSize: 14, fontWeight: "700" },
    searchWrap: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginHorizontal: 20,
        marginBottom: 8,
        paddingHorizontal: 12,
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        backgroundColor: c.surface,
    },
    search: { flex: 1, paddingVertical: 11, color: c.ink, fontSize: 15 },
    list: { paddingHorizontal: 20, paddingBottom: 24 },
    row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 11,
        borderBottomColor: c.border,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
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
    rowValue: { color: c.ink, fontSize: 14, fontWeight: "600" },
    empty: { color: c.muted, textAlign: "center", paddingVertical: 48, fontSize: 14 },
    backdrop: { flex: 1, backgroundColor: c.scrim, justifyContent: "flex-end" },
    sheet: {
        backgroundColor: c.surface,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        padding: 22,
        paddingBottom: 36,
        maxHeight: "88%",
    },
    sheetHead: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 12,
    },
    sheetHeadMain: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
    sheetHeadText: { flex: 1 },
    sheetTitle: { color: c.ink, fontSize: 18, fontWeight: "700" },
    sheetBody: { marginBottom: 8 },
    note: { color: c.muted, fontSize: 13, marginTop: 6, lineHeight: 18 },
    section: { marginTop: 14 },
    sectionHead: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    sectionLabel: {
        color: c.muted,
        fontSize: 11,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
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
    addRow: { flexDirection: "row", gap: 8, marginTop: 10 },
    outlineBtn: {
        flex: 1,
        alignItems: "center",
        paddingVertical: 10,
        borderRadius: theme.radius,
        borderColor: c.border,
        borderWidth: 1,
    },
    outlineBtnText: { color: c.inkSoft, fontSize: 13, fontWeight: "600" },
    setupBox: {
        marginTop: 10,
        padding: 14,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.bg,
    },
    setupTitle: { color: c.ink, fontSize: 15, fontWeight: "700" },
    setupNote: { color: c.muted, fontSize: 12, marginTop: 6, lineHeight: 17 },
    setupSecret: { color: c.muted, fontSize: 11, marginTop: 8 },
    setupActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },
    chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
    chip: {
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 20,
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.border,
    },
    chipOn: { backgroundColor: c.accent, borderColor: c.accent },
    chipText: { color: c.ink, fontSize: 13, fontWeight: "500" },
    chipTextOn: { color: c.accentInk },
    fieldSpace: { marginTop: 14 },
    errorText: { color: c.danFg, fontSize: 13, marginTop: 8 },
    modalBackdrop: {
        flex: 1,
        backgroundColor: c.scrim,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
    },
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
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 },
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
    disabled: { opacity: 0.5 },
});
