import { type AddPaymentMethod, strings } from "@clientbridge/app-core";
import { Pressable, Text } from "react-native";

import { CardForm } from "./CardForm";
import { ui } from "./styles";

/** Save a card for a client. Bank (PAD) mandates are web-only for now, so `allowBank` is ignored. */
export function PaymentMethodForm({ flow }: { flow: AddPaymentMethod; allowBank: boolean }) {
    if (flow.intent !== null && flow.kind === "card") {
        return (
            <CardForm
                clientSecret={flow.intent.client_secret}
                stripeAccount={flow.intent.stripe_account_id}
                mode="setup"
                submitLabel={strings.card.saveCard}
                busyLabel={strings.common.saving}
                onDone={flow.complete}
                onCancel={flow.cancel}
            />
        );
    }
    return (
        <>
            <Pressable
                style={[ui.outline, flow.busy && ui.disabled]}
                disabled={flow.busy}
                onPress={() => {
                    flow.start("card");
                }}
            >
                <Text style={ui.outlineText}>
                    {flow.busy ? strings.clients.starting : strings.clients.addCard}
                </Text>
            </Pressable>
            {flow.error !== null ? <Text style={ui.error}>{flow.error}</Text> : null}
        </>
    );
}
