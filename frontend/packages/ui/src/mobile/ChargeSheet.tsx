import { type Checkout, type CheckoutMethod, NEW_CARD, strings } from "@clientbridge/app-core";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { Button } from "./Button";
import { CardForm } from "./CardForm";
import { Choice } from "./Choice";
import { Field } from "./Field";
import { Notice } from "./Notice";
import { stripeAccount as currentStripeAccount } from "./stripe";
import { ui } from "./styles";

export interface ChargeSheetProps {
    checkout: Checkout;
    methods: CheckoutMethod[];
    amountLabel: string;
    stripeAccount?: string;
    submitLabel: string;
    busyLabel: string;
    onSubmit: () => void;
    onCancel: () => void;
    title?: string;
    children?: ReactNode;
}

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
                stripeAccount={stripeAccount ?? currentStripeAccount()}
                submitLabel={strings.checkout.charge(amountLabel)}
                busyLabel={strings.checkout.charging}
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
            <Field label={strings.checkout.payment}>
                {options.length === 0 ? (
                    <Text style={ui.note}>{strings.checkout.addMethodFirst}</Text>
                ) : (
                    <Choice
                        options={options.map((m) => ({ key: m.id, label: m.label }))}
                        value={checkout.method}
                        onChange={checkout.setMethod}
                        label={strings.checkout.payment}
                    />
                )}
            </Field>
            {checkout.error !== null ? <Notice tone="danger">{checkout.error}</Notice> : null}
            <View style={ui.actions}>
                <Button variant="quiet" onPress={onCancel}>
                    {strings.common.cancel}
                </Button>
                <Button onPress={onSubmit} busy={checkout.busy}>
                    {checkout.busy ? busyLabel : submitLabel}
                </Button>
            </View>
        </View>
    );
}
