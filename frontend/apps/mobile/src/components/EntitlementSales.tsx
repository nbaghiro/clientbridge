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
    useStripeAccountId,
    useSubscriptionForm,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { type ReactNode, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { api } from "../lib/api";
import { ChargeSheet } from "../ui/ChargeSheet";
import { ui } from "../ui/styles";

const c = theme.colors;

function ChipChoice<T>({
    options,
    selected,
    label,
    onPick,
    keyOf,
}: {
    options: readonly T[];
    selected: (o: T) => boolean;
    label: (o: T) => string;
    onPick: (o: T) => void;
    keyOf: (o: T) => string;
}) {
    return (
        <View style={ui.chipWrap}>
            {options.map((o) => (
                <Pressable
                    key={keyOf(o)}
                    style={[ui.chip, selected(o) ? ui.chipOn : null]}
                    onPress={() => {
                        onPick(o);
                    }}
                >
                    <Text style={[ui.chipText, selected(o) ? ui.chipTextOn : null]}>
                        {label(o)}
                    </Text>
                </Pressable>
            ))}
        </View>
    );
}

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
        <ChipChoice
            options={clients}
            keyOf={(cl) => cl.id}
            selected={(cl) => cl.id === value}
            label={(cl) => cl.name}
            onPick={(cl) => {
                onChange(cl.id === value ? "" : cl.id);
            }}
        />
    );
}

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
            submitLabel={strings.giftCards.sellShort}
            busyLabel={strings.giftCards.selling}
            onSubmit={form.submit}
            onCancel={onClose}
        >
            <Text style={ui.label}>{strings.giftCards.purchaser}</Text>
            <ClientChips
                clients={clients}
                value={form.purchaserClientId}
                onChange={form.setPurchaserClientId}
            />
            <Text style={ui.label}>{strings.giftCards.type}</Text>
            <ChipChoice
                options={GIFT_SALE_MODES}
                keyOf={(m) => m}
                selected={(m) => m === form.mode}
                label={(m) => GIFT_SALE_MODE_LABEL[m]}
                onPick={form.setMode}
            />
            {form.mode === "preset" ? (
                <>
                    <Text style={ui.label}>{strings.giftCards.giftCard}</Text>
                    {items.length === 0 ? (
                        <Text style={ui.note}>{strings.giftCards.emptyCatalog}</Text>
                    ) : (
                        <ChipChoice
                            options={items}
                            keyOf={(it) => it.id}
                            selected={(it) => it.id === form.itemId}
                            label={(it) =>
                                it.price_cents !== null
                                    ? `${it.name} · ${formatMoney(it.price_cents)}`
                                    : it.name
                            }
                            onPick={(it) => {
                                form.setItemId(it.id);
                            }}
                        />
                    )}
                </>
            ) : (
                <>
                    <Text style={ui.label}>{strings.giftCards.amountCad}</Text>
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
            <Text style={ui.label}>{strings.giftCards.recipientOptional}</Text>
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
                <Pressable style={ui.cancel} onPress={onClose}>
                    <Text style={ui.cancelText}>{strings.common.cancel}</Text>
                </Pressable>
            </View>
        </View>
    );
}

function PackageSale({ clientId, onClose }: { clientId: string; onClose: () => void }) {
    const items = useCatalogItems();
    const offerings = useMemo(() => packageOfferings(items), [items]);
    const cards = useSavedCards(clientId);
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
            <Text style={ui.label}>{strings.clients.packageLabel}</Text>
            <ItemChoice
                items={offerings}
                value={form.itemId}
                onChange={form.setItemId}
                empty={strings.clients.addPackageItemFirst}
            />
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
            stripeAccount=""
            submitLabel={strings.clients.startSubscription}
            busyLabel={strings.clients.starting}
            onSubmit={form.submit}
            onCancel={onClose}
        >
            <Text style={ui.label}>{strings.clients.planLabel}</Text>
            <ItemChoice
                items={plans}
                value={form.itemId}
                onChange={form.setItemId}
                empty={strings.clients.addSubscriptionItemFirst}
            />
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
        <ChipChoice
            options={items}
            keyOf={(i) => i.id}
            selected={(i) => i.id === value}
            label={(i) => `${i.name} · ${formatMoney(i.price_cents)}`}
            onPick={(i) => {
                onChange(i.id);
            }}
        />
    );
}

const styles = StyleSheet.create({
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
});
