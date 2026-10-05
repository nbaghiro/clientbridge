import {
    type GiftCardRow,
    giftCardStatusIntent,
    useGiftCardRedeemForm,
    strings,
    useGiftCards,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button, ListPage, Money, Notice, Panel, StatusPill, TextField } from "@clientbridge/ui";

import { SellGiftCard } from "../components/EntitlementSales";

import { api } from "../lib/api";

const c = theme.colors;

export function GiftCards() {
    const cards = useGiftCards();
    const [mode, setMode] = useState<"sell" | "redeem" | null>(null);

    return (
        <ListPage
            summary={strings.entitlements.giftCards.issuedCount(cards.length)}
            accessory={
                <Button
                    variant="outline"
                    onPress={() => {
                        setMode(mode === "redeem" ? null : "redeem");
                    }}
                >
                    {strings.entitlements.giftCards.redeem}
                </Button>
            }
            action={{
                label: strings.entitlements.giftCards.sell,
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
            empty={strings.entitlements.giftCards.emptyList}
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
        <Panel title={strings.entitlements.giftCards.redeemTitle}>
            <TextField
                label={strings.entitlements.giftCards.code}
                value={form.code}
                onChange={form.setCode}
                placeholder={strings.entitlements.giftCards.codePlaceholder}
            />
            <TextField
                label={strings.entitlements.giftCards.amountCad}
                type="number"
                value={form.amount}
                onChange={form.setAmount}
                placeholder={strings.entitlements.giftCards.redeemAmountPlaceholder}
            />

            {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
            <View style={styles.panelActions}>
                <Button variant="quiet" onPress={onClose}>
                    {strings.common.cancel}
                </Button>
                <Button busy={form.busy} onPress={form.submit}>
                    {strings.entitlements.giftCards.redeem}
                </Button>
            </View>
        </Panel>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 10 },
    rowMain: { flex: 1 },
    code: { color: c.ink, fontSize: 14, fontWeight: "700", letterSpacing: 0.5 },
    meta: { color: c.muted, fontSize: 12, marginTop: 1 },
    panelActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 14 },
});
