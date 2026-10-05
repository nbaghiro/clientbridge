import {
    type GiftCardRow,
    formatMoney,
    giftCardStatusIntent,
    useGiftCardRedeemForm,
    strings,
    useGiftCards,
} from "@clientbridge/app-core";
import { Button, ListPage, Money, Notice, Panel, StatusPill, TextField } from "@clientbridge/ui";
import { useState } from "react";

import { SellGiftCard } from "../components/EntitlementSales";
import { api } from "../lib/api";

const GRID = "grid grid-cols-[1.4fr_2fr_1fr_1.4fr] items-center gap-4";

export function GiftCards() {
    const cards = useGiftCards();
    const [mode, setMode] = useState<"sell" | "redeem" | null>(null);

    return (
        <div className="max-w-3xl">
            <ListPage
                summary={strings.giftCards.issuedCount(cards.length)}
                action={{
                    label: strings.giftCards.sell,
                    onPress: () => {
                        setMode(mode === "sell" ? null : "sell");
                    },
                }}
                accessory={
                    <Button
                        variant="outline"
                        onPress={() => {
                            setMode(mode === "redeem" ? null : "redeem");
                        }}
                    >
                        {strings.giftCards.redeem}
                    </Button>
                }
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
                head={
                    <div className={GRID}>
                        <span>{strings.giftCards.code}</span>
                        <span>{strings.giftCards.recipient}</span>
                        <span>{strings.giftCards.status}</span>
                        <span className="text-right">{strings.giftCards.balance}</span>
                    </div>
                }
                rows={cards}
                rowKey={(card) => card.id}
                empty={strings.giftCards.emptyList}
                renderRow={(card) => <GiftCardRowItem card={card} />}
            />
        </div>
    );
}

function GiftCardRowItem({ card }: { card: GiftCardRow }) {
    return (
        <div className={GRID}>
            <span className="font-mono text-ink">{card.code}</span>
            <span className="truncate text-ink-soft">{card.recipient ?? strings.clients.dash}</span>
            <span>
                <StatusPill status={card.status} intent={giftCardStatusIntent(card.status)} />
            </span>
            <span className="text-right">
                <Money cents={card.balance_cents} />
                {card.balance_cents !== card.initial_cents ? (
                    <span className="text-xs text-muted">
                        {" "}
                        {strings.giftCards.ofInitial(formatMoney(card.initial_cents))}
                    </span>
                ) : null}
            </span>
        </div>
    );
}

function RedeemGiftCard({ onClose }: { onClose: () => void }) {
    const form = useGiftCardRedeemForm(api, onClose);

    return (
        <Panel title={strings.giftCards.redeemTitle}>
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    form.submit();
                }}
                className="space-y-3"
            >
                <TextField
                    label={strings.giftCards.code}
                    value={form.code}
                    onChange={form.setCode}
                    placeholder={strings.giftCards.codePlaceholder}
                />
                <TextField
                    label={strings.giftCards.amountCad}
                    type="number"
                    value={form.amount}
                    onChange={form.setAmount}
                    placeholder={strings.giftCards.redeemAmountPlaceholder}
                />
                {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                <div className="flex justify-end gap-2">
                    <Button variant="quiet" onPress={onClose}>
                        {strings.common.cancel}
                    </Button>
                    <Button submit busy={form.busy}>
                        {form.busy ? strings.giftCards.redeeming : strings.giftCards.redeem}
                    </Button>
                </div>
            </form>
        </Panel>
    );
}
