import { type AddPaymentMethod, strings } from "@clientbridge/app-core";
import { StyleSheet, View } from "react-native";

import { Button } from "./Button";
import { CardForm } from "./CardForm";
import { Notice } from "./Notice";

/** Save a card for a client. Bank (PAD) mandates are web-only for now, so `allowBank` is ignored. */
export function PaymentMethodForm({ flow }: { flow: AddPaymentMethod; allowBank: boolean }) {
    if (flow.intent !== null && flow.kind === "card") {
        return (
            <CardForm
                clientSecret={flow.intent.client_secret}
                stripeAccount={flow.intent.stripe_account_id}
                mode="setup"
                submitLabel={strings.checkout.saveCard}
                busyLabel={strings.common.saving}
                onDone={flow.complete}
                onCancel={flow.cancel}
            />
        );
    }
    return (
        <>
            <View style={styles.start}>
                <Button
                    variant="outline"
                    busy={flow.busy}
                    onPress={() => {
                        flow.start("card");
                    }}
                >
                    {flow.busy ? strings.clients.starting : strings.clients.addCard}
                </Button>
            </View>
            {flow.error !== null ? <Notice tone="danger">{flow.error}</Notice> : null}
        </>
    );
}

const styles = StyleSheet.create({ start: { marginTop: 10 } });
