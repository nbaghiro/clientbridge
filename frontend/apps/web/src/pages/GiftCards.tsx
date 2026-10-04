import {
    checkoutMethods,
    type ClientRow,
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
import { ChargeSheet, StatusPill } from "@clientbridge/ui";
import { useState } from "react";

import { ListPage } from "../components/ListPage";
import { Money } from "../components/Money";
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
            submitLabel={strings.giftCards.sell}
            busyLabel={strings.giftCards.selling}
            onSubmit={form.submit}
            onCancel={onClose}
        >
            <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                {strings.giftCards.purchaser}
                <ClientSelect
                    clients={clients}
                    value={form.purchaserClientId}
                    onChange={form.setPurchaserClientId}
                />
            </label>
            <div className="flex gap-2">
                {GIFT_SALE_MODES.map((m) => (
                    <button
                        key={m}
                        type="button"
                        onClick={() => {
                            form.setMode(m);
                        }}
                        className={`flex-1 rounded-md border px-3 py-2 text-sm font-semibold transition ${
                            form.mode === m
                                ? "border-accent bg-accent-weak text-accent-strong"
                                : "border-line text-ink-soft hover:bg-bg"
                        }`}
                    >
                        {GIFT_SALE_MODE_LABEL[m]}
                    </button>
                ))}
            </div>
            {form.mode === "preset" ? (
                <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                    {strings.giftCards.giftCard}
                    <select
                        value={form.itemId}
                        onChange={(e) => {
                            form.setItemId(e.target.value);
                        }}
                        className={field}
                    >
                        <option value="">{strings.giftCards.selectGiftCard}</option>
                        {items.map((it) => (
                            <option key={it.id} value={it.id}>
                                {it.name}
                                {it.price_cents !== null ? ` — ${formatMoney(it.price_cents)}` : ""}
                            </option>
                        ))}
                    </select>
                </label>
            ) : (
                <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                    {strings.giftCards.amountCad}
                    <input
                        value={form.amount}
                        onChange={(e) => {
                            form.setAmount(e.target.value);
                        }}
                        inputMode="decimal"
                        placeholder={strings.giftCards.amountPlaceholder}
                        className={field}
                    />
                </label>
            )}
            <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                {strings.giftCards.recipientOptional}
                <input
                    value={form.recipient}
                    onChange={(e) => {
                        form.setRecipient(e.target.value);
                    }}
                    placeholder={strings.giftCards.recipientPlaceholder}
                    className={field}
                />
            </label>
        </ChargeSheet>
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

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="mt-5 rounded-lg border border-line bg-surface p-5 shadow-card">
            <h2 className="mb-3 font-display text-base font-bold text-ink">{title}</h2>
            {children}
        </section>
    );
}

function ClientSelect({
    clients,
    value,
    onChange,
}: {
    clients: ClientRow[];
    value: string;
    onChange: (v: string) => void;
}) {
    return (
        <select
            value={value}
            onChange={(e) => {
                onChange(e.target.value);
            }}
            className={field}
        >
            <option value="">{strings.giftCards.selectClient}</option>
            {clients.map((cl) => (
                <option key={cl.id} value={cl.id}>
                    {cl.name}
                </option>
            ))}
        </select>
    );
}
