import { strings, useAsyncAction, type CardFormProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    CardField,
    type CardFieldInput,
    useConfirmPayment,
    useConfirmSetupIntent,
} from "@stripe/stripe-react-native";
import { useState } from "react";
import { Text, View } from "react-native";

import { Button } from "./Button";
import { Notice } from "./Notice";
import type { NativeProps } from "./props";
import { stripeConfigured } from "./stripe";
import { ui } from "./styles";

const c = theme.colors;

const cardStyle: CardFieldInput.Styles = {
    backgroundColor: c.surface,
    textColor: c.ink,
    placeholderColor: c.muted,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: 8,
};

/** Native card entry that confirms a server-minted client secret (a charge or a saved card). */
export function CardForm(props: NativeProps<CardFormProps>) {
    if (!stripeConfigured()) {
        return (
            <View style={[ui.box, props.style]}>
                <Text style={ui.note}>{strings.checkout.notConfiguredSavedCard}</Text>
                {props.onCancel !== undefined ? (
                    <View style={ui.actions}>
                        <Button variant="quiet" onPress={props.onCancel}>
                            {strings.checkout.back}
                        </Button>
                    </View>
                ) : null}
            </View>
        );
    }
    return <ConfirmForm {...props} />;
}

function ConfirmForm({
    clientSecret,
    mode = "payment",
    submitLabel,
    onDone,
    onCancel,
    style,
}: NativeProps<CardFormProps>) {
    const { confirmPayment } = useConfirmPayment();
    const { confirmSetupIntent } = useConfirmSetupIntent();
    const { busy, error, run } = useAsyncAction();
    const [ready, setReady] = useState(false);

    const submit = (): void => {
        run(
            async () => {
                const result =
                    mode === "payment"
                        ? await confirmPayment(clientSecret, { paymentMethodType: "Card" })
                        : await confirmSetupIntent(clientSecret, { paymentMethodType: "Card" });
                if (result.error) throw new Error(result.error.message);
            },
            {
                onSuccess: onDone,
                errorMessage:
                    mode === "payment"
                        ? strings.checkout.paymentFailed
                        : strings.checkout.saveError,
            },
        );
    };

    return (
        <View style={[ui.box, style]}>
            <CardField
                postalCodeEnabled
                cardStyle={cardStyle}
                style={ui.card}
                onCardChange={(d) => {
                    setReady(d.complete);
                }}
            />
            {error !== null ? <Notice tone="danger">{error}</Notice> : null}
            <View style={ui.actions}>
                {onCancel !== undefined ? (
                    <Button variant="quiet" onPress={onCancel} disabled={busy}>
                        {strings.common.cancel}
                    </Button>
                ) : null}
                <Button onPress={submit} busy={busy} disabled={!ready}>
                    {submitLabel}
                </Button>
            </View>
        </View>
    );
}
