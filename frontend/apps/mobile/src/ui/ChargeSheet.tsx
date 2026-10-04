import { type Checkout, type CheckoutMethod, NEW_CARD, strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { CardForm } from "./CardForm";
import { ui } from "./styles";

const c = theme.colors;

export interface ChargeSheetProps {
    checkout: Checkout;
    methods: CheckoutMethod[];
    amountLabel: string;
    stripeAccount: string;
    submitLabel: string;
    busyLabel: string;
    onSubmit: () => void;
    onCancel: () => void;
    title?: string;
    children?: ReactNode;
}

/** The one place a sale is paid for: the sale's fields, a saved card or a new card, then the card
 *  confirm when a new card needs it. */
export function ChargeSheet({
    checkout,
    methods,
    amountLabel,
    stripeAccount,
    submitLabel,
    busyLabel,
    onSubmit,
    onCancel,
    title,
    children,
}: ChargeSheetProps) {
    if (checkout.clientSecret !== null) {
        return (
            <CardForm
                clientSecret={checkout.clientSecret}
                stripeAccount={stripeAccount}
                submitLabel={strings.card.charge(amountLabel)}
                busyLabel={strings.card.charging}
                onDone={checkout.complete}
                onCancel={checkout.cancel}
            />
        );
    }
    const options: CheckoutMethod[] = checkout.allowNewCard
        ? [{ id: NEW_CARD, label: strings.checkout.newCard }, ...methods]
        : methods;
    return (
        <View style={ui.panel}>
            {title !== undefined ? <Text style={ui.title}>{title}</Text> : null}
            {children}
            <Text style={ui.label}>{strings.checkout.payment}</Text>
            {options.length === 0 ? (
                <Text style={ui.note}>{strings.checkout.addMethodFirst}</Text>
            ) : (
                <View style={ui.chipWrap}>
                    {options.map((m) => {
                        const on = checkout.method === m.id;
                        return (
                            <Pressable
                                key={m.id === NEW_CARD ? "new" : m.id}
                                style={[ui.chip, on && ui.chipOn]}
                                onPress={() => {
                                    checkout.setMethod(m.id);
                                }}
                            >
                                <Text style={[ui.chipText, on && ui.chipTextOn]}>{m.label}</Text>
                            </Pressable>
                        );
                    })}
                </View>
            )}
            {checkout.error !== null ? <Text style={ui.error}>{checkout.error}</Text> : null}
            <View style={ui.actions}>
                <Pressable style={ui.cancel} onPress={onCancel}>
                    <Text style={ui.cancelText}>{strings.common.cancel}</Text>
                </Pressable>
                <Pressable
                    style={[ui.primary, checkout.busy && ui.disabled]}
                    disabled={checkout.busy}
                    onPress={onSubmit}
                    accessibilityLabel={checkout.busy ? busyLabel : submitLabel}
                >
                    {checkout.busy ? (
                        <ActivityIndicator color={c.accentInk} />
                    ) : (
                        <Text style={ui.primaryText}>{submitLabel}</Text>
                    )}
                </Pressable>
            </View>
        </View>
    );
}
