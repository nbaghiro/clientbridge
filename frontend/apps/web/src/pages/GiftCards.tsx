import {
    type GiftCardRow,
    formatMoney,
    giftCardStatusIntent,
    useGiftCardRedeemForm,
    strings,
    useGiftCards,
} from "@clientbridge/app-core";
import { ListPage, Money, Panel, StatusPill } from "@clientbridge/ui";
import { useState } from "react";

import { SellGiftCard } from "../components/EntitlementSales";
import { api } from "../lib/api";

const field =
    "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-hidden placeholder:text-muted focus:border-accent";

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
                    <button
                        type="button"
                        onClick={() => {
                            setMode(mode === "redeem" ? null : "redeem");
                        }}
                        className="rounded-md border border-line px-3.5 py-2 text-sm font-semibold text-ink-soft transition hover:bg-bg"
                    >
                        {strings.giftCards.redeem}
                    </button>
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
                <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                    {strings.giftCards.code}
                    <input
                        value={form.code}
                        onChange={(e) => {
                            form.setCode(e.target.value);
                        }}
                        placeholder={strings.giftCards.codePlaceholder}
                        autoCapitalize="characters"
                        className={`${field} font-mono`}
                    />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                    {strings.giftCards.amountCad}
                    <input
                        value={form.amount}
                        onChange={(e) => {
                            form.setAmount(e.target.value);
                        }}
                        inputMode="decimal"
                        placeholder={strings.giftCards.redeemAmountPlaceholder}
                        className={field}
                    />
                </label>
                {form.error !== null ? <p className="text-sm text-danger">{form.error}</p> : null}
                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-surface"
                    >
                        {strings.common.cancel}
                    </button>
                    <button
                        type="submit"
                        disabled={form.busy}
                        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                    >
                        {form.busy ? strings.giftCards.redeeming : strings.giftCards.redeem}
                    </button>
                </div>
            </form>
        </Panel>
    );
}
