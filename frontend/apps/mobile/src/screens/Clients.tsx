import {
    type AddPaymentMethod,
    type ClientRow,
    type ItemRow,
    type PackageRow,
    type SavedCardRow,
    type SetupIntent,
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
    subscriptionPlans,
    subscriptionStatusIntent,
    useAddPaymentMethod,
    useAsyncAction,
    useCatalogItems,
    useClientForm,
    useClientPackages,
    useClientSubscriptions,
    useClients,
    useCurrentRole,
    usePackageSaleForm,
    useSavedCards,
    useSearch,
    useSubscriptionForm,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { type ComponentProps, useEffect, useState } from "react";
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
import { PurchaseConfirmPanel } from "../components/PurchaseConfirmPanel";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import { getTokens } from "../lib/auth";

const c = theme.colors;

// The native card-confirm seam: the native Stripe SDK (the follow) collects card / PAD bank details,
// confirms the SetupIntent `client_secret`, and resolves — mirroring the POS Terminal token seam.
// It isn't wired in this build, so nothing is injected and the panel renders a clear placeholder.
type ConfirmCardSetup = (intent: SetupIntent) => Promise<void>;

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
                    <Text style={styles.title}>Clients</Text>
                    <Text style={styles.count}>{clients.length} total</Text>
                </View>
                <Pressable
                    style={styles.add}
                    onPress={() => {
                        setAdding(true);
                    }}
                >
                    <IconPlus size={16} color={theme.colors.accentInk} />
                    <Text style={styles.addText}>Add</Text>
                </Pressable>
            </View>

            <View style={styles.searchWrap}>
                <IconSearch size={16} color={theme.colors.muted} />
                <TextInput
                    style={styles.search}
                    value={q}
                    onChangeText={setQ}
                    placeholder="Search clients…"
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
                        {q ? "No clients match your search." : "No clients yet."}
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
                    {cl.email ?? cl.phone ?? "—"}
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
    const [token, setToken] = useState<string | null>(null);
    useEffect(() => {
        void getTokens().then((t) => {
            setToken(t?.access_token ?? null);
        });
    }, []);
    const canManage = canManagePayments(useCurrentRole(token));

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
                                            {client.email ?? client.phone ?? "—"}
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
                                        Only owners and admins can manage payment methods,
                                        subscriptions, and packages.
                                    </Text>
                                )}
                            </ScrollView>
                            <View style={styles.actions}>
                                <Pressable style={styles.cancel} onPress={onClose}>
                                    <Text style={styles.cancelText}>Close</Text>
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
            <Text style={styles.sectionLabel}>Payment methods</Text>
            {cards.length === 0 ? (
                <Text style={styles.note}>No saved payment methods yet.</Text>
            ) : (
                cards.map((card) => <CardRow key={card.id} card={card} />)
            )}
            <AddMethodPanel flow={flow} />
            {flow.error !== null ? <Text style={styles.errorText}>{flow.error}</Text> : null}
        </View>
    );
}

function AddMethodPanel({ flow, confirm }: { flow: AddPaymentMethod; confirm?: ConfirmCardSetup }) {
    const intent = flow.intent;
    if (intent !== null) {
        const runConfirm = (): void => {
            if (confirm === undefined) return;
            void confirm(intent).then(flow.complete);
        };
        return (
            <View style={styles.setupBox}>
                <Text style={styles.setupTitle}>
                    {flow.kind === "bank" ? "Authorize pre-authorized debit" : "Add card"}
                </Text>
                <Text style={styles.setupNote}>
                    Card entry needs the native Stripe SDK (not wired in this build).
                </Text>
                <Text style={styles.setupSecret} numberOfLines={1}>
                    SetupIntent: {intent.client_secret}
                </Text>
                <View style={styles.setupActions}>
                    <Pressable style={styles.cancel} onPress={flow.cancel}>
                        <Text style={styles.cancelText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                        style={[styles.save, confirm === undefined && styles.disabled]}
                        disabled={confirm === undefined}
                        onPress={runConfirm}
                    >
                        <Text style={styles.saveText}>Confirm</Text>
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
                    <Text style={styles.outlineBtnText}>Add card</Text>
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
                    <Text style={styles.outlineBtnText}>Add bank (PAD)</Text>
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
            errorMessage: "Couldn't set the default. Please try again.",
        });
    };

    const remove = (): void => {
        Alert.alert("Remove payment method", "Remove this payment method?", [
            { text: "Cancel", style: "cancel" },
            {
                text: "Remove",
                style: "destructive",
                onPress: () =>
                    void run(() => detachCard(api, card.id), {
                        errorMessage: "Couldn't remove this method. Please try again.",
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
                            <Text style={styles.defaultTagText}>Default</Text>
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
                        <Text style={styles.miniBtnText}>Make default</Text>
                    </Pressable>
                ) : null}
                <Pressable style={styles.miniBtn} disabled={busy} onPress={remove}>
                    <Text style={styles.miniBtnText}>Remove</Text>
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
                <Text style={styles.sectionLabel}>Subscriptions</Text>
                {!starting ? (
                    <Pressable
                        onPress={() => {
                            setStarting(true);
                        }}
                    >
                        <Text style={styles.linkText}>+ Start subscription</Text>
                    </Pressable>
                ) : null}
            </View>
            {subs.length === 0 ? (
                <Text style={styles.note}>No subscriptions yet.</Text>
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
        Alert.alert("Cancel subscription", "Cancel this subscription?", [
            { text: "Keep", style: "cancel" },
            {
                text: "Cancel subscription",
                style: "destructive",
                onPress: () =>
                    void run(() => cancelSubscription(api, sub.id), {
                        errorMessage: "Couldn't cancel this subscription. Please try again.",
                    }),
            },
        ]);
    };

    return (
        <View style={styles.methodRow}>
            <View style={styles.methodMain}>
                <Text style={styles.methodLabel}>{sub.item_name ?? "Subscription"}</Text>
                {nextCharge !== null ? (
                    <Text style={styles.rowSub}>Next charge {nextCharge}</Text>
                ) : null}
            </View>
            <View style={styles.methodActions}>
                <StatusBadge status={sub.status} intent={subscriptionStatusIntent(sub.status)} />
                {isCancelable(sub.status) ? (
                    <Pressable style={styles.miniBtn} disabled={busy} onPress={cancel}>
                        <Text style={styles.miniBtnText}>{busy ? "…" : "Cancel"}</Text>
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
            <Text style={styles.fieldLabel}>Plan</Text>
            {plans.length === 0 ? (
                <Text style={styles.note}>Add a subscription item in your catalog first.</Text>
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

            <Text style={[styles.fieldLabel, styles.fieldSpace]}>Payment method</Text>
            {cards.length === 0 ? (
                <Text style={styles.note}>Add a payment method above first.</Text>
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
                    <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.save} disabled={form.busy} onPress={form.submit}>
                    {form.busy ? (
                        <ActivityIndicator color={c.accentInk} />
                    ) : (
                        <Text style={styles.saveText}>Start</Text>
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
                <Text style={styles.sectionLabel}>Packages</Text>
                {!selling ? (
                    <Pressable
                        onPress={() => {
                            setSelling(true);
                        }}
                    >
                        <Text style={styles.linkText}>+ Sell package</Text>
                    </Pressable>
                ) : null}
            </View>
            {packages.length === 0 ? (
                <Text style={styles.note}>No packages yet.</Text>
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
            errorMessage: "Couldn't consume a session. Please try again.",
        });
    };

    return (
        <View style={styles.methodRow}>
            <View style={styles.methodMain}>
                <Text style={styles.methodLabel}>{pkg.item_name ?? "Package"}</Text>
                <Text style={styles.rowSub}>
                    {sessionsRemaining(pkg)} of {pkg.sessions_total} left
                </Text>
            </View>
            <View style={styles.methodActions}>
                <StatusBadge status={pkg.status} intent={packageStatusIntent(pkg.status)} />
                {canConsume(pkg) ? (
                    <Pressable style={styles.miniBtn} disabled={busy} onPress={consume}>
                        <Text style={styles.miniBtnText}>{busy ? "…" : "Consume"}</Text>
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
            <PurchaseConfirmPanel
                clientSecret={form.clientSecret}
                onCancel={form.cancel}
                onConfirmed={form.complete}
            />
        );
    }

    return (
        <View style={styles.setupBox}>
            <Text style={styles.fieldLabel}>Package</Text>
            {offerings.length === 0 ? (
                <Text style={styles.note}>Add a package item in your catalog first.</Text>
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

            <Text style={[styles.fieldLabel, styles.fieldSpace]}>Payment</Text>
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
                        New card
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
                    <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.save} disabled={form.busy} onPress={form.submit}>
                    {form.busy ? (
                        <ActivityIndicator color={c.accentInk} />
                    ) : (
                        <Text style={styles.saveText}>Sell</Text>
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
                    <Text style={styles.modalTitle}>Add client</Text>
                    <ModalField
                        label="Name"
                        value={form.name}
                        onChangeText={form.setName}
                        autoFocus
                    />
                    <ModalField
                        label="Email"
                        value={form.email}
                        onChangeText={form.setEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                    />
                    <ModalField label="Phone" value={form.phone} onChangeText={form.setPhone} />
                    {form.error ? <Text style={styles.error}>{form.error}</Text> : null}
                    <View style={styles.modalActions}>
                        <Pressable style={styles.cancel} onPress={onClose}>
                            <Text style={styles.cancelText}>Cancel</Text>
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
                                <Text style={styles.saveText}>Add client</Text>
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
