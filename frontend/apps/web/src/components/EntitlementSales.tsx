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
    useSubscriptionForm,
} from "@clientbridge/app-core";
import { Button, ChargeSheet, Choice, Select, TextField } from "@clientbridge/ui";
import { useMemo, useState } from "react";

import { api } from "../lib/api";

export function SellGiftCard({ onClose }: { onClose: () => void }) {
    const form = useGiftCardSaleForm(api, onClose);
    const clients = useClients();
    const cards = useSavedCards(form.purchaserClientId);
    const items = giftItems(useCatalogItems());

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
            submitLabel={strings.giftCards.sell}
            busyLabel={strings.giftCards.selling}
            onSubmit={form.submit}
            onCancel={onClose}
        >
            <ClientSelect
                label={strings.giftCards.purchaser}
                clients={clients}
                value={form.purchaserClientId}
                onChange={form.setPurchaserClientId}
            />
            <Choice
                layout="segmented"
                options={GIFT_SALE_MODES.map((m) => ({ key: m, label: GIFT_SALE_MODE_LABEL[m] }))}
                value={form.mode}
                onChange={form.setMode}
            />
            {form.mode === "preset" ? (
                <Select
                    label={strings.giftCards.giftCard}
                    value={form.itemId}
                    options={[
                        { key: "", label: strings.giftCards.selectGiftCard },
                        ...items.map((it) => ({
                            key: it.id,
                            label:
                                it.price_cents !== null
                                    ? `${it.name} — ${formatMoney(it.price_cents)}`
                                    : it.name,
                        })),
                    ]}
                    onChange={form.setItemId}
                />
            ) : (
                <TextField
                    label={strings.giftCards.amountCad}
                    type="number"
                    value={form.amount}
                    onChange={form.setAmount}
                    placeholder={strings.giftCards.amountPlaceholder}
                />
            )}
            <TextField
                label={strings.giftCards.recipient}
                optional
                value={form.recipient}
                onChange={form.setRecipient}
                placeholder={strings.giftCards.recipientPlaceholder}
            />
        </ChargeSheet>
    );
}

export function ClientSelect({
    label,
    clients,
    value,
    onChange,
}: {
    label: string;
    clients: ClientRow[];
    value: string;
    onChange: (v: string) => void;
}) {
    return (
        <Select
            label={label}
            value={value}
            options={[
                { key: "", label: strings.giftCards.selectClient },
                ...clients.map((cl) => ({ key: cl.id, label: cl.name })),
            ]}
            onChange={onChange}
        />
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
            <ClientSelect
                label={strings.pos.clientLabel}
                clients={clients}
                value={picked}
                onChange={setPicked}
            />
            <p className="text-xs text-muted">{strings.pos.chooseClient}</p>
            <div className="flex justify-end">
                <Button variant="quiet" onPress={onClose}>
                    {strings.common.cancel}
                </Button>
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
            submitLabel={strings.clients.startSubscription}
            busyLabel={strings.clients.starting}
            onSubmit={form.submit}
            onCancel={onClose}
        >
            <Select
                label={strings.clients.planLabel}
                value={form.itemId}
                options={[
                    { key: "", label: strings.clients.selectPlan },
                    ...plans.map((p) => ({
                        key: p.id,
                        label: `${p.name} — ${formatMoney(p.price_cents)}`,
                    })),
                ]}
                onChange={form.setItemId}
            />
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
    const offering = offerings.find((o) => o.id === form.itemId);

    return (
        <ChargeSheet
            checkout={form.checkout}
            methods={checkoutMethods(cards)}
            amountLabel={
                offering ? formatMoney(offering.price_cents) : strings.clients.packageAmountFallback
            }
            submitLabel={strings.clients.sellPackage}
            busyLabel={strings.clients.selling}
            onSubmit={form.submit}
            onCancel={onClose}
        >
            <Select
                label={strings.clients.packageLabel}
                value={form.itemId}
                options={[
                    { key: "", label: strings.clients.selectPackage },
                    ...offerings.map((o) => ({
                        key: o.id,
                        label: `${o.name} — ${formatMoney(o.price_cents)}`,
                    })),
                ]}
                onChange={form.setItemId}
            />
            {offerings.length === 0 ? (
                <p className="text-xs text-muted">{strings.clients.addPackageItemFirst}</p>
            ) : null}
        </ChargeSheet>
    );
}
