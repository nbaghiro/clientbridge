import {
    type GiftCardRow,
    giftCardStatusIntent,
    useGiftCardRedeemForm,
    strings,
    useGiftCards,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { SellGiftCard } from "../components/EntitlementSales";

import { ListPage } from "../ui/ListPage";
import { Money } from "../ui/Money";
import { StatusPill } from "../ui/StatusPill";
import { api } from "../lib/api";

const c = theme.colors;

export function GiftCardsScreen() {
    const cards = useGiftCards();
    const [mode, setMode] = useState<"sell" | "redeem" | null>(null);

    return (
        <ListPage
            summary={strings.giftCards.issuedCount(cards.length)}
            accessory={
                <Pressable
                    style={[styles.outlineBtn, mode === "redeem" && styles.outlineBtnOn]}
                    onPress={() => {
                        setMode(mode === "redeem" ? null : "redeem");
                    }}
                >
                    <Text style={styles.outlineBtnText}>{strings.giftCards.redeem}</Text>
                </Pressable>
            }
            action={{
                label: strings.giftCards.sell,
                onPress: () => {
                    setMode(mode === "sell" ? null : "sell");
                },
            }}
            banner={
                mode === "sell" ? (
                    <SellGiftCard
                        onClose={() => {
                            setMode(null);
                        }}
                    />
                ) : mode === "redeem" ? (
                    <RedeemGiftCard
                        onClose={() => {
                            setMode(null);
                        }}
                    />
                ) : undefined
            }
            rows={cards}
            rowKey={(card) => card.id}
            empty={strings.giftCards.emptyList}
            renderRow={(card) => <GiftCardItem card={card} />}
        />
    );
}

function GiftCardItem({ card }: { card: GiftCardRow }) {
    return (
        <View style={styles.row}>
            <View style={styles.rowMain}>
                <Text style={styles.code}>{card.code}</Text>
                {card.recipient !== null ? (
                    <Text style={styles.meta} numberOfLines={1}>
                        {card.recipient}
                    </Text>
                ) : null}
            </View>
            <Money cents={card.balance_cents} strong />
            <StatusPill status={card.status} intent={giftCardStatusIntent(card.status)} />
        </View>
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
    error: { color: c.danFg, fontSize: 13, marginTop: 8 },
    outlineBtn: {
        alignItems: "center",
        paddingHorizontal: 13,
        paddingVertical: 9,
        borderRadius: theme.radius,
        borderColor: c.border,
        borderWidth: 1,
    },
    outlineBtnOn: { backgroundColor: c.surface, borderColor: c.accent },
    outlineBtnText: { color: c.inkSoft, fontSize: 14, fontWeight: "700" },
    row: { flexDirection: "row", alignItems: "center", gap: 10 },
    rowMain: { flex: 1 },
    code: { color: c.ink, fontSize: 14, fontWeight: "700", letterSpacing: 0.5 },
    meta: { color: c.muted, fontSize: 12, marginTop: 1 },
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
