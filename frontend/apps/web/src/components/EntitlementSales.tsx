import {
    type ClientRow,
    GIFT_SALE_MODES,
    GIFT_SALE_MODE_LABEL,
    type ItemRow,
    type SavedCardRow,
    checkoutMethods,
    formatMoney,
    giftItems,
    packageOfferings,
    strings,
    subscriptionPlans,
    useCatalogItems,
    useClients,
    useGiftCardSaleForm,
    usePackageSaleForm,
    useSavedCards,
    useStripeAccountId,
    useSubscriptionForm,
} from "@clientbridge/app-core";
import { ChargeSheet, field } from "@clientbridge/ui";
import { useMemo, useState } from "react";

import { api } from "../lib/api";

export function SellGiftCard({ onClose }: { onClose: () => void }) {
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

export function ClientSelect({
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

/** Sell a package: to the given client, or after picking one (from Sales). */
export function SellPackage({
    clientId,
    onClose,
}: {
    clientId: string | null;
    onClose: () => void;
}) {
    return (
        <WithClient clientId={clientId} onClose={onClose}>
            {(id) => <PackageSale clientId={id} onClose={onClose} />}
        </WithClient>
    );
}

/** Start a subscription: for the given client, or after picking one (from Sales). */
export function StartSubscription({
    clientId,
    onClose,
}: {
    clientId: string | null;
    onClose: () => void;
}) {
    return (
        <WithClient clientId={clientId} onClose={onClose}>
            {(id) => <SubscriptionStart clientId={id} onClose={onClose} />}
        </WithClient>
    );
}

function PackageSale({ clientId, onClose }: { clientId: string; onClose: () => void }) {
    const items = useCatalogItems();
    const offerings = useMemo(() => packageOfferings(items), [items]);
    const cards = useSavedCards(clientId);
    return (
        <SellPackageForm
            clientId={clientId}
            offerings={offerings}
            cards={cards}
            onClose={onClose}
        />
    );
}

function SubscriptionStart({ clientId, onClose }: { clientId: string; onClose: () => void }) {
    const items = useCatalogItems();
    const plans = useMemo(() => subscriptionPlans(items), [items]);
    const cards = useSavedCards(clientId);
    return (
        <StartSubscriptionForm clientId={clientId} plans={plans} cards={cards} onClose={onClose} />
    );
}

function WithClient({
    clientId,
    onClose,
    children,
}: {
    clientId: string | null;
    onClose: () => void;
    children: (clientId: string) => React.ReactNode;
}) {
    const clients = useClients();
    const [picked, setPicked] = useState("");
    const id = clientId ?? (picked === "" ? null : picked);
    if (id !== null) return <>{children(id)}</>;
    return (
        <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
            <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                {strings.pos.clientLabel}
                <ClientSelect clients={clients} value={picked} onChange={setPicked} />
            </label>
            <p className="text-xs text-muted">{strings.pos.chooseClient}</p>
            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={onClose}
                    className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-bg"
                >
                    {strings.common.cancel}
                </button>
            </div>
        </div>
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
    const plan = plans.find((p) => p.id === form.itemId);

    return (
        <ChargeSheet
            checkout={form.checkout}
            methods={checkoutMethods(cards)}
            amountLabel={plan ? formatMoney(plan.price_cents) : ""}
            stripeAccount=""
            submitLabel={strings.clients.startSubscription}
            busyLabel={strings.clients.starting}
            onSubmit={form.submit}
            onCancel={onClose}
        >
            <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                {strings.clients.planLabel}
                <select
                    value={form.itemId}
                    onChange={(e) => {
                        form.setItemId(e.target.value);
                    }}
                    className={field}
                >
                    <option value="">{strings.clients.selectPlan}</option>
                    {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.name} — {formatMoney(p.price_cents)}
                        </option>
                    ))}
                </select>
            </label>
            {plans.length === 0 ? (
                <p className="text-xs text-muted">{strings.clients.addSubscriptionItemFirst}</p>
            ) : null}
        </ChargeSheet>
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
    const stripeAccount = useStripeAccountId() ?? "";
    const offering = offerings.find((o) => o.id === form.itemId);

    return (
        <ChargeSheet
            checkout={form.checkout}
            methods={checkoutMethods(cards)}
            amountLabel={
                offering ? formatMoney(offering.price_cents) : strings.clients.packageAmountFallback
            }
            stripeAccount={stripeAccount}
            submitLabel={strings.clients.sellPackage}
            busyLabel={strings.clients.selling}
            onSubmit={form.submit}
            onCancel={onClose}
        >
            <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                {strings.clients.packageLabel}
                <select
                    value={form.itemId}
                    onChange={(e) => {
                        form.setItemId(e.target.value);
                    }}
                    className={field}
                >
                    <option value="">{strings.clients.selectPackage}</option>
                    {offerings.map((o) => (
                        <option key={o.id} value={o.id}>
                            {o.name} — {formatMoney(o.price_cents)}
                        </option>
                    ))}
                </select>
            </label>
            {offerings.length === 0 ? (
                <p className="text-xs text-muted">{strings.clients.addPackageItemFirst}</p>
            ) : null}
        </ChargeSheet>
    );
}
