import {
    type ClientRow,
    GIFT_SALE_MODES,
    GIFT_SALE_MODE_LABEL,
    type ItemRow,
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
import { type ReactNode, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Button, ChargeSheet, Choice, Field, TextField, ui } from "@clientbridge/ui";

import { api } from "../lib/api";

export function ClientChips({
    clients,
    value,
    onChange,
}: {
    clients: ClientRow[];
    value: string;
    onChange: (id: string) => void;
}) {
    if (clients.length === 0)
        return <Text style={ui.note}>{strings.giftCards.addClientFirst}</Text>;
    return (
        <Choice
            options={clients.map((cl) => ({ key: cl.id, label: cl.name }))}
            value={value}
            onChange={(id) => {
                onChange(id === value ? "" : id);
            }}
        />
    );
}

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
            submitLabel={strings.giftCards.sellShort}
            busyLabel={strings.giftCards.selling}
            onSubmit={form.submit}
            onCancel={onClose}
        >
            <Field label={strings.giftCards.purchaser}>
                <ClientChips
                    clients={clients}
                    value={form.purchaserClientId}
                    onChange={form.setPurchaserClientId}
                />
            </Field>
            <Field label={strings.giftCards.type}>
                <Choice
                    layout="segmented"
                    options={GIFT_SALE_MODES.map((m) => ({
                        key: m,
                        label: GIFT_SALE_MODE_LABEL[m],
                    }))}
                    value={form.mode}
                    onChange={form.setMode}
                />
            </Field>
            {form.mode === "preset" ? (
                <Field label={strings.giftCards.giftCard}>
                    {items.length === 0 ? (
                        <Text style={ui.note}>{strings.giftCards.emptyCatalog}</Text>
                    ) : (
                        <Choice
                            options={items.map((it) => ({
                                key: it.id,
                                label:
                                    it.price_cents !== null
                                        ? `${it.name} · ${formatMoney(it.price_cents)}`
                                        : it.name,
                            }))}
                            value={form.itemId}
                            onChange={form.setItemId}
                        />
                    )}
                </Field>
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

function WithClient({
    clientId,
    onClose,
    children,
}: {
    clientId: string | null;
    onClose: () => void;
    children: (clientId: string) => ReactNode;
}) {
    const clients = useClients();
    const [picked, setPicked] = useState("");
    const id = clientId ?? (picked === "" ? null : picked);
    if (id !== null) return <>{children(id)}</>;
    return (
        <View style={ui.panel}>
            <Text style={ui.title}>{strings.pos.clientLabel}</Text>
            <ClientChips clients={clients} value={picked} onChange={setPicked} />
            <Text style={ui.note}>{strings.pos.chooseClient}</Text>
            <View style={ui.actions}>
                <Button variant="quiet" onPress={onClose}>
                    {strings.common.cancel}
                </Button>
            </View>
        </View>
    );
}

function PackageSale({ clientId, onClose }: { clientId: string; onClose: () => void }) {
    const items = useCatalogItems();
    const offerings = useMemo(() => packageOfferings(items), [items]);
    const cards = useSavedCards(clientId);
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
            <Field label={strings.clients.packageLabel}>
                <ItemChoice
                    items={offerings}
                    value={form.itemId}
                    onChange={form.setItemId}
                    empty={strings.clients.addPackageItemFirst}
                />
            </Field>
        </ChargeSheet>
    );
}

function SubscriptionStart({ clientId, onClose }: { clientId: string; onClose: () => void }) {
    const items = useCatalogItems();
    const plans = useMemo(() => subscriptionPlans(items), [items]);
    const cards = useSavedCards(clientId);
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
            <Field label={strings.clients.planLabel}>
                <ItemChoice
                    items={plans}
                    value={form.itemId}
                    onChange={form.setItemId}
                    empty={strings.clients.addSubscriptionItemFirst}
                />
            </Field>
        </ChargeSheet>
    );
}

function ItemChoice({
    items,
    value,
    onChange,
    empty,
}: {
    items: ItemRow[];
    value: string;
    onChange: (id: string) => void;
    empty: string;
}) {
    if (items.length === 0) return <Text style={ui.note}>{empty}</Text>;
    return (
        <Choice
            options={items.map((i) => ({
                key: i.id,
                label: `${i.name} · ${formatMoney(i.price_cents)}`,
            }))}
            value={value}
            onChange={onChange}
        />
    );
}
