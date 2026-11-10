import { strings, useAsyncAction, type CardFormProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    CardField,
    type CardFieldInput,
    PaymentIntent,
    retrievePaymentIntent,
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

// Drawn like Field's input on a box: same font, size, border and radius.
const cardStyle: CardFieldInput.Styles = {
    backgroundColor: c.surface,
    textColor: c.ink,
    placeholderColor: c.muted,
    textErrorColor: c.danFg,
    cursorColor: c.accent,
    borderColor: c.border,
    borderWidth: theme.borderWidth,
    borderRadius: theme.radius,
    fontFamily: theme.fonts.ui,
    fontSize: 15,
};

/** Native card entry that confirms a server-minted client secret (a charge or a saved card). */
export function CardForm(props: NativeProps<CardFormProps>) {
    if (!stripeConfigured()) {
        return (
            <View style={[ui.box, props.style]}>
                <Text style={ui.note}>
                    {props.mode === "setup"
                        ? strings.checkout.notConfiguredSetup
                        : strings.checkout.notConfiguredSavedCard}
                </Text>
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

// paid from another tab or device: the payment went through, so it's done
async function alreadyPaid(clientSecret: string): Promise<boolean> {
    const { paymentIntent } = await retrievePaymentIntent(clientSecret);
    return (
        paymentIntent?.status === PaymentIntent.Status.Succeeded ||
        paymentIntent?.status === PaymentIntent.Status.Processing
    );
}

function ConfirmForm({
    clientSecret,
    mode = "payment",
    submitLabel,
    onDone,
    onCancel,
    defaultValue,
    style,
}: NativeProps<CardFormProps>) {
    const { confirmPayment } = useConfirmPayment();
    const { confirmSetupIntent } = useConfirmSetupIntent();
    const { busy, error, setError, run } = useAsyncAction();
    const failed = mode === "payment" ? strings.checkout.paymentFailed : strings.checkout.saveError;
    const [ready, setReady] = useState(false);

    const submit = (): void => {
        const paymentMethodData = {
            billingDetails: {
                ...(defaultValue?.name ? { name: defaultValue.name } : {}),
                ...(defaultValue?.email ? { email: defaultValue.email } : {}),
            },
        };
        run(
            async () => {
                const result =
                    mode === "payment"
                        ? await confirmPayment(clientSecret, {
                              paymentMethodType: "Card",
                              paymentMethodData,
                          })
                        : await confirmSetupIntent(clientSecret, {
                              paymentMethodType: "Card",
                              paymentMethodData,
                          });
                // Stripe's own words for a decline, as the web card form shows them
                if (result.error && !(mode === "payment" && (await alreadyPaid(clientSecret)))) {
                    setError(result.error.localizedMessage ?? failed);
                    return;
                }
                onDone();
            },
            { errorMessage: failed },
        );
    };

    return (
        <View style={[ui.box, style]}>
            <CardField
                postalCodeEnabled
                placeholders={{ postalCode: strings.checkout.postalCode }}
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
