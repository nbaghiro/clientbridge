import {
    checkoutMethods,
    type GiftCardRow,
    formatMoney,
    giftCardStatusIntent,
    giftItems,
    useCatalogItems,
    useClients,
    useGiftCardRedeemForm,
    GIFT_SALE_MODES,
    GIFT_SALE_MODE_LABEL,
    strings,
    useGiftCardSaleForm,
    useGiftCards,
    useSavedCards,
    useStripeAccountId,
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

import { ChargeSheet } from "../ui/ChargeSheet";
import { StatusPill } from "../ui/StatusPill";
import { api } from "../lib/api";

const c = theme.colors;

export function GiftCardsScreen() {
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
                    <Text style={styles.outlineBtnText}>{strings.giftCards.redeem}</Text>
                </Pressable>
                <Pressable
                    style={styles.primaryBtn}
                    onPress={() => {
                        setMode(mode === "sell" ? null : "sell");
                    }}
                >
                    <Text style={styles.primaryBtnText}>{strings.giftCards.sell}</Text>
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
                <Text style={styles.muted}>{strings.giftCards.emptyList}</Text>
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
            <StatusPill status={card.status} intent={giftCardStatusIntent(card.status)} />
        </View>
    );
}

function SellGiftCard({ onClose }: { onClose: () => void }) {
    const form = useGiftCardSaleForm(api, onClose);
    const clients = useClients();
    const cards = useSavedCards(form.purchaserClientId);
    const items = giftItems(useCatalogItems());
    const stripeAccount = useStripeAccountId() ?? "";

    return (
        <ChargeSheet
            title={strings.giftCards.sell}
            checkout={form.checkout}
            methods={checkoutMethods(cards)}
            amountLabel={
                form.faceAmountCents !== null
                    ? formatMoney(form.faceAmountCents)
                    : strings.giftCards.amountFallback
            }
            stripeAccount={stripeAccount}
            submitLabel={strings.giftCards.sellShort}
            busyLabel={strings.giftCards.selling}
            onSubmit={form.submit}
            onCancel={onClose}
        >
            <Text style={styles.fieldLabel}>{strings.giftCards.purchaser}</Text>
            {clients.length === 0 ? (
                <Text style={styles.muted}>{strings.giftCards.addClientFirst}</Text>
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

            <Text style={[styles.fieldLabel, styles.fieldSpace]}>{strings.giftCards.type}</Text>
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
                    <Text style={[styles.fieldLabel, styles.fieldSpace]}>
                        {strings.giftCards.giftCard}
                    </Text>
                    {items.length === 0 ? (
                        <Text style={styles.muted}>{strings.giftCards.emptyCatalog}</Text>
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
                    <Text style={[styles.fieldLabel, styles.fieldSpace]}>
                        {strings.giftCards.amountCad}
                    </Text>
                    <TextInput
                        style={styles.input}
                        value={form.amount}
                        onChangeText={form.setAmount}
                        keyboardType="decimal-pad"
                        placeholder={strings.giftCards.amountPlaceholder}
                        placeholderTextColor={c.muted}
                    />
                </>
            )}

            <Text style={[styles.fieldLabel, styles.fieldSpace]}>
                {strings.giftCards.recipientOptional}
            </Text>
            <TextInput
                style={styles.input}
                value={form.recipient}
                onChangeText={form.setRecipient}
                placeholder={strings.giftCards.recipientPlaceholder}
                placeholderTextColor={c.muted}
                autoCapitalize="none"
            />
        </ChargeSheet>
    );
}

function RedeemGiftCard({ onClose }: { onClose: () => void }) {
    const form = useGiftCardRedeemForm(api, onClose);

    return (
        <View style={styles.panel}>
            <Text style={styles.panelTitle}>{strings.giftCards.redeemTitle}</Text>

            <Text style={styles.fieldLabel}>{strings.giftCards.code}</Text>
            <TextInput
                style={styles.input}
                value={form.code}
                onChangeText={form.setCode}
                placeholder={strings.giftCards.codePlaceholder}
                placeholderTextColor={c.muted}
                autoCapitalize="characters"
                autoCorrect={false}
            />

            <Text style={[styles.fieldLabel, styles.fieldSpace]}>
                {strings.giftCards.amountCad}
            </Text>
            <TextInput
                style={styles.input}
                value={form.amount}
                onChangeText={form.setAmount}
                keyboardType="decimal-pad"
                placeholder={strings.giftCards.redeemAmountPlaceholder}
                placeholderTextColor={c.muted}
            />

            {form.error !== null ? <Text style={styles.error}>{form.error}</Text> : null}
            <View style={styles.panelActions}>
                <Pressable style={styles.cancel} onPress={onClose}>
                    <Text style={styles.cancelText}>{strings.common.cancel}</Text>
                </Pressable>
                <Pressable style={styles.save} disabled={form.busy} onPress={form.submit}>
                    {form.busy ? (
                        <ActivityIndicator color={c.accentInk} />
                    ) : (
                        <Text style={styles.saveText}>{strings.giftCards.redeem}</Text>
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
