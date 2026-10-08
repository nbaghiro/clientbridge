import { type PaymentMethodFormProps, strings } from "@clientbridge/app-core";
import { StyleSheet, View, Share } from "react-native";

import { Button } from "./Button";
import { CardForm } from "./CardForm";
import { Notice } from "./Notice";
import type { NativeProps } from "./props";

export function PaymentMethodForm({ flow, allowBank, style }: NativeProps<PaymentMethodFormProps>) {
    if (flow.intent !== null && flow.kind === "card") {
        return (
            <CardForm
                style={style}
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
        <View style={style}>
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
            {allowBank ? (
                <Button
                    variant="outline"
                    busy={flow.busy}
                    onPress={() => {
                        flow.start("bank");
                    }}
                >
                    {strings.clients.addBankWeb}
                </Button>
            ) : null}
            {flow.bankLink !== null ? (
                <View style={styles.start}>
                    <Notice tone="info">{strings.checkout.bankLinkHelp}</Notice>
                    <Button
                        onPress={() => {
                            Share.share({ message: flow.bankLink?.url ?? "" }).catch(() => {
                                flow.setError(strings.checkout.bankLinkError);
                            });
                        }}
                    >
                        {strings.checkout.bankLinkShare}
                    </Button>
                    <Button variant="quiet" onPress={flow.revokeBankLink} busy={flow.busy}>
                        {strings.checkout.bankLinkRevoke}
                    </Button>
                </View>
            ) : null}
            {flow.error !== null ? <Notice tone="danger">{flow.error}</Notice> : null}
        </View>
    );
}

const styles = StyleSheet.create({ start: { marginTop: 10 } });
