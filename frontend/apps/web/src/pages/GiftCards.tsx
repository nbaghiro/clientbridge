import {
    type ClientRow,
    type GiftCardRow,
    type SavedCardRow,
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
    strings,
    useGiftCardSaleForm,
    useGiftCards,
    useSavedCards,
    useStripeAccountId,
} from "@clientbridge/app-core";
import { useState } from "react";

import { CardConfirm } from "../components/CardConfirm";
import { StatusPill } from "../components/StatusPill";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";

const field =
    "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-accent";

export function GiftCards() {
    const role = useRole();
    const cards = useGiftCards();
    const [mode, setMode] = useState<"sell" | "redeem" | null>(null);

    if (!canManagePayments(role))
        return (
            <div className="mx-auto max-w-3xl px-8 py-8">
                <h1 className="font-display text-2xl font-bold">{strings.giftCards.title}</h1>
                <p className="mt-4 text-sm text-muted">{strings.giftCards.ownerAdminOnly}</p>
            </div>
        );

    return (
        <div className="mx-auto max-w-3xl px-8 py-8">
            <header className="flex items-center justify-between gap-4">
                <div>
                    <h1 className="font-display text-2xl font-bold">{strings.giftCards.title}</h1>
                    <p className="mt-0.5 text-sm text-muted">
                        {strings.giftCards.issuedCount(cards.length)}
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => {
                            setMode(mode === "redeem" ? null : "redeem");
                        }}
                        className="rounded-md border border-line px-3.5 py-2 text-sm font-semibold text-ink-soft transition hover:bg-bg"
                    >
                        {strings.giftCards.redeem}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setMode(mode === "sell" ? null : "sell");
                        }}
                        className="rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90"
                    >
                        {strings.giftCards.sell}
                    </button>
                </div>
            </header>

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

            <div className="mt-6 overflow-hidden rounded-lg border border-line bg-surface">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                            <th className="px-4 py-3 font-semibold">{strings.giftCards.code}</th>
                            <th className="px-4 py-3 font-semibold">
                                {strings.giftCards.recipient}
                            </th>
                            <th className="px-4 py-3 font-semibold">{strings.giftCards.status}</th>
                            <th className="px-4 py-3 text-right font-semibold">
                                {strings.giftCards.balance}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {cards.map((card) => (
                            <GiftCardRowItem key={card.id} card={card} />
                        ))}
                        {cards.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={4}
                                    className="px-4 py-12 text-center text-sm text-muted"
                                >
                                    {strings.giftCards.emptyList}
                                </td>
                            </tr>
                        ) : null}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function GiftCardRowItem({ card }: { card: GiftCardRow }) {
    return (
        <tr className="border-b border-line-soft last:border-0">
            <td className="px-4 py-3 font-mono text-ink">{card.code}</td>
            <td className="px-4 py-3 text-ink-soft">{card.recipient ?? "—"}</td>
            <td className="px-4 py-3">
                <StatusPill status={card.status} intent={giftCardStatusIntent(card.status)} />
            </td>
            <td className="px-4 py-3 text-right font-medium tabular-nums text-ink">
                {formatMoney(card.balance_cents)}
                {card.balance_cents !== card.initial_cents ? (
                    <span className="text-xs text-muted">
                        {" "}
                        {strings.giftCards.ofInitial(formatMoney(card.initial_cents))}
                    </span>
                ) : null}
            </td>
        </tr>
    );
}

function SellGiftCard({ onClose }: { onClose: () => void }) {
    const form = useGiftCardSaleForm(api, onClose);
    const clients = useClients();
    const cards = useSavedCards(form.purchaserClientId);
    const items = giftItems(useCatalogItems());
    const stripeAccount = useStripeAccountId() ?? "";

    if (form.clientSecret !== null) {
        return (
            <Panel title={strings.giftCards.confirmPayment}>
                <CardConfirm
                    clientSecret={form.clientSecret}
                    stripeAccount={stripeAccount}
                    amountLabel={
                        form.faceAmountCents !== null
                            ? formatMoney(form.faceAmountCents)
                            : strings.giftCards.amountFallback
                    }
                    onPaid={form.complete}
                    onCancel={form.cancel}
                />
            </Panel>
        );
    }

    return (
        <Panel title={strings.giftCards.sell}>
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    form.submit();
                }}
                className="space-y-3"
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
                                    {it.price_cents !== null
                                        ? ` — ${formatMoney(it.price_cents)}`
                                        : ""}
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
                <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                    {strings.giftCards.payment}
                    <select
                        value={form.paymentMethodId}
                        onChange={(e) => {
                            form.setPaymentMethodId(e.target.value);
                        }}
                        className={field}
                    >
                        <option value="">{strings.giftCards.payNewCard}</option>
                        {cards.map((card: SavedCardRow) => (
                            <option key={card.id} value={card.id}>
                                {savedCardLabel(card)}
                            </option>
                        ))}
                    </select>
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
                        {form.busy ? strings.giftCards.selling : strings.giftCards.sell}
                    </button>
                </div>
            </form>
        </Panel>
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
