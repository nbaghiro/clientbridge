import {
    type GiftCardRow,
    canManagePayments,
    formatMoney,
    giftCardStatusIntent,
    giftItems,
    savedCardLabel,
    useCatalogItems,
    useClients,
    useGiftCardRedeemForm,
    GIFT_SALE_MODES,
    GIFT_SALE_MODE_LABEL,
    useGiftCardSaleForm,
    useGiftCards,
    useSavedCards,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import { CardPaymentConfirm } from "../components/stripe";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";

const c = theme.colors;

export function GiftCardsScreen() {
    const role = useRole();

    if (!canManagePayments(role)) {
        return (
            <View style={[styles.screen, styles.center]}>
                <Text style={styles.muted}>Gift cards are available to owners and admins.</Text>
            </View>
        );
    }
    return <GiftCardsBody />;
}

function GiftCardsBody() {
    const cards = useGiftCards();
    const [mode, setMode] = useState<"sell" | "redeem" | null>(null);

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <View style={styles.actions}>
                <Pressable
                    style={[styles.outlineBtn, mode === "redeem" && styles.outlineBtnOn]}
                    onPress={() => {
                        setMode(mode === "redeem" ? null : "redeem");
                    }}
                >
                    <Text style={styles.outlineBtnText}>Redeem</Text>
                </Pressable>
                <Pressable
                    style={styles.primaryBtn}
                    onPress={() => {
                        setMode(mode === "sell" ? null : "sell");
                    }}
                >
                    <Text style={styles.primaryBtnText}>Sell gift card</Text>
                </Pressable>
            </View>

            {mode === "sell" ? (
                <SellGiftCard
                    onClose={() => {
                        setMode(null);
                    }}
                />
            ) : null}
            {mode === "redeem" ? (
                <RedeemGiftCard
                    onClose={() => {
                        setMode(null);
                    }}
                />
            ) : null}

            {cards.length === 0 ? (
                <Text style={styles.muted}>No gift cards issued yet.</Text>
            ) : (
                <View style={styles.list}>
                    {cards.map((card, i) => (
                        <GiftCardItem key={card.id} card={card} divider={i > 0} />
                    ))}
                </View>
            )}
        </ScrollView>
    );
}

function GiftCardItem({ card, divider }: { card: GiftCardRow; divider: boolean }) {
    return (
        <View style={[styles.row, divider && styles.rowDivider]}>
            <View style={styles.rowMain}>
                <Text style={styles.code}>{card.code}</Text>
                {card.recipient !== null ? (
                    <Text style={styles.meta} numberOfLines={1}>
                        {card.recipient}
                    </Text>
                ) : null}
            </View>
            <Text style={styles.amount}>{formatMoney(card.balance_cents)}</Text>
            <StatusBadge status={card.status} intent={giftCardStatusIntent(card.status)} />
        </View>
    );
}

function SellGiftCard({ onClose }: { onClose: () => void }) {
    const form = useGiftCardSaleForm(api, onClose);
    const clients = useClients();
    const cards = useSavedCards(form.purchaserClientId);
    const items = giftItems(useCatalogItems());

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
        <View style={styles.panel}>
            <Text style={styles.panelTitle}>Sell gift card</Text>

            <Text style={styles.fieldLabel}>Purchaser</Text>
            {clients.length === 0 ? (
                <Text style={styles.muted}>Add a client first.</Text>
            ) : (
                <View style={styles.chipWrap}>
                    {clients.map((cl) => (
                        <Pressable
                            key={cl.id}
                            style={[styles.chip, form.purchaserClientId === cl.id && styles.chipOn]}
                            onPress={() => {
                                form.setPurchaserClientId(cl.id);
                            }}
                        >
                            <Text
                                style={[
                                    styles.chipText,
                                    form.purchaserClientId === cl.id && styles.chipTextOn,
                                ]}
                            >
                                {cl.name}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            )}

            <Text style={[styles.fieldLabel, styles.fieldSpace]}>Type</Text>
            <View style={styles.chipWrap}>
                {GIFT_SALE_MODES.map((m) => (
                    <Pressable
                        key={m}
                        style={[styles.chip, form.mode === m && styles.chipOn]}
                        onPress={() => {
                            form.setMode(m);
                        }}
                    >
                        <Text style={[styles.chipText, form.mode === m && styles.chipTextOn]}>
                            {GIFT_SALE_MODE_LABEL[m]}
                        </Text>
                    </Pressable>
                ))}
            </View>

            {form.mode === "preset" ? (
                <>
                    <Text style={[styles.fieldLabel, styles.fieldSpace]}>Gift card</Text>
                    {items.length === 0 ? (
                        <Text style={styles.muted}>No gift cards in your catalog.</Text>
                    ) : (
                        <View style={styles.chipWrap}>
                            {items.map((it) => (
                                <Pressable
                                    key={it.id}
                                    style={[styles.chip, form.itemId === it.id && styles.chipOn]}
                                    onPress={() => {
                                        form.setItemId(it.id);
                                    }}
                                >
                                    <Text
                                        style={[
                                            styles.chipText,
                                            form.itemId === it.id && styles.chipTextOn,
                                        ]}
                                    >
                                        {it.name}
                                        {it.price_cents !== null
                                            ? ` · ${formatMoney(it.price_cents)}`
                                            : ""}
                                    </Text>
                                </Pressable>
                            ))}
                        </View>
                    )}
                </>
            ) : (
                <>
                    <Text style={[styles.fieldLabel, styles.fieldSpace]}>Amount (CAD)</Text>
                    <TextInput
                        style={styles.input}
                        value={form.amount}
                        onChangeText={form.setAmount}
                        keyboardType="decimal-pad"
                        placeholder="100.00"
                        placeholderTextColor={c.muted}
                    />
                </>
            )}

            <Text style={[styles.fieldLabel, styles.fieldSpace]}>Recipient (optional)</Text>
            <TextInput
                style={styles.input}
                value={form.recipient}
                onChangeText={form.setRecipient}
                placeholder="Name or email"
                placeholderTextColor={c.muted}
                autoCapitalize="none"
            />

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

            {form.error !== null ? <Text style={styles.error}>{form.error}</Text> : null}
            <View style={styles.panelActions}>
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

function RedeemGiftCard({ onClose }: { onClose: () => void }) {
    const form = useGiftCardRedeemForm(api, onClose);

    return (
        <View style={styles.panel}>
            <Text style={styles.panelTitle}>Redeem gift card</Text>

            <Text style={styles.fieldLabel}>Code</Text>
            <TextInput
                style={styles.input}
                value={form.code}
                onChangeText={form.setCode}
                placeholder="ABCD2345EFGH"
                placeholderTextColor={c.muted}
                autoCapitalize="characters"
                autoCorrect={false}
            />

            <Text style={[styles.fieldLabel, styles.fieldSpace]}>Amount (CAD)</Text>
            <TextInput
                style={styles.input}
                value={form.amount}
                onChangeText={form.setAmount}
                keyboardType="decimal-pad"
                placeholder="25.00"
                placeholderTextColor={c.muted}
            />

            {form.error !== null ? <Text style={styles.error}>{form.error}</Text> : null}
            <View style={styles.panelActions}>
                <Pressable style={styles.cancel} onPress={onClose}>
                    <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.save} disabled={form.busy} onPress={form.submit}>
                    {form.busy ? (
                        <ActivityIndicator color={c.accentInk} />
                    ) : (
                        <Text style={styles.saveText}>Redeem</Text>
                    )}
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    center: { alignItems: "center", justifyContent: "center" },
    content: { padding: 16, gap: 14 },
    muted: { color: c.muted, fontSize: 14 },
    error: { color: c.danFg, fontSize: 13, marginTop: 8 },
    actions: { flexDirection: "row", gap: 8 },
    outlineBtn: {
        flex: 1,
        alignItems: "center",
        paddingVertical: 11,
        borderRadius: theme.radius,
        borderColor: c.border,
        borderWidth: 1,
    },
    outlineBtnOn: { backgroundColor: c.surface, borderColor: c.accent },
    outlineBtnText: { color: c.inkSoft, fontSize: 14, fontWeight: "700" },
    primaryBtn: {
        flex: 1,
        alignItems: "center",
        paddingVertical: 11,
        borderRadius: theme.radius,
        backgroundColor: c.accent,
    },
    primaryBtnText: { color: c.accentInk, fontSize: 14, fontWeight: "700" },
    list: {
        backgroundColor: c.surface,
        borderColor: c.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        overflow: "hidden",
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    rowDivider: { borderTopWidth: theme.borderWidth, borderTopColor: c.borderSoft },
    rowMain: { flex: 1 },
    code: { color: c.ink, fontSize: 14, fontWeight: "700", letterSpacing: 0.5 },
    meta: { color: c.muted, fontSize: 12, marginTop: 1 },
    amount: { color: c.ink, fontSize: 14, fontWeight: "700", fontVariant: ["tabular-nums"] },
    panel: {
        backgroundColor: c.surface,
        borderColor: c.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        padding: 16,
    },
    panelTitle: { color: c.ink, fontSize: 16, fontWeight: "700", marginBottom: 12 },
    fieldLabel: { color: c.inkSoft, fontSize: 13, fontWeight: "600", marginBottom: 6 },
    fieldSpace: { marginTop: 14 },
    input: {
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: theme.radius,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: c.ink,
        fontSize: 15,
        backgroundColor: c.bg,
    },
    chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 20,
        backgroundColor: c.bg,
        borderWidth: 1,
        borderColor: c.border,
    },
    chipOn: { backgroundColor: c.accent, borderColor: c.accent },
    chipText: { color: c.ink, fontSize: 13, fontWeight: "500" },
    chipTextOn: { color: c.accentInk },
    panelActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 14 },
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
