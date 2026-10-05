import { strings, useAsyncAction } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
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
import { stripeConfigured } from "./stripe";
import { ui } from "./styles";

const c = theme.colors;

export interface CardFormProps {
    clientSecret: string;
    /** The connected account; on mobile the StripeProvider already targets it. */
    stripeAccount: string;
    mode?: "payment" | "setup";
    submitLabel: string;
    busyLabel: string;
    onDone: () => void;
    onCancel?: () => void;
}

const cardStyle: CardFieldInput.Styles = {
    backgroundColor: c.surface,
    textColor: c.ink,
    placeholderColor: c.muted,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: 8,
};

/** Native card entry that confirms a server-minted client secret (a charge or a saved card). */
export function CardForm(props: CardFormProps) {
    if (!stripeConfigured()) {
        return (
            <View style={ui.box}>
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
}: CardFormProps) {
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
        <View style={ui.box}>
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
