import { NEW_CARD, strings, type ChargeSheetProps } from "@clientbridge/app-core";
import { Text, View } from "react-native";

import { Button } from "./Button";
import { CardForm } from "./CardForm";
import { Choice } from "./Choice";
import { Field } from "./Field";
import { Notice } from "./Notice";
import { Panel } from "./Panel";
import type { NativeProps } from "./props";
import { stripeAccount as currentStripeAccount } from "./stripe";
import { ui } from "./styles";

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
    style,
}: NativeProps<ChargeSheetProps>) {
    if (checkout.clientSecret !== null) {
        return (
            <CardForm
                style={style}
                clientSecret={checkout.clientSecret}
                stripeAccount={stripeAccount ?? currentStripeAccount()}
                submitLabel={strings.checkout.charge(amountLabel)}
                busyLabel={strings.checkout.charging}
                onDone={checkout.complete}
                onCancel={checkout.cancel}
            />
        );
    }
    const options: readonly { id: string; label: string }[] = checkout.allowNewCard
        ? [{ id: NEW_CARD, label: strings.checkout.newCard }, ...methods]
        : methods;
    return (
        <Panel style={style} title={title}>
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
                <Button
                    onPress={onSubmit}
                    busy={checkout.busy}
                    disabled={!checkout.allowNewCard && checkout.method === NEW_CARD}
                >
                    {checkout.busy ? busyLabel : submitLabel}
                </Button>
            </View>
        </Panel>
    );
}
