import { type PaymentMethodFormProps, strings } from "@clientbridge/app-core";
import { StyleSheet, View, Share } from "react-native";

import { Button } from "./Button";
import { CardForm } from "./CardForm";
import { Notice } from "./Notice";
import { Skeleton } from "./Skeleton";
import type { NativeProps } from "./props";

export function PaymentMethodForm({ flow, allowBank, style }: NativeProps<PaymentMethodFormProps>) {
    const s = strings.checkout;
    if (flow.intent !== null && flow.kind === "card") {
        return (
            <CardForm
                style={style}
                clientSecret={flow.intent.client_secret}
                stripeAccount={flow.intent.stripe_account_id}
                mode="setup"
                submitLabel={s.saveCard}
                busyLabel={strings.common.saving}
                onDone={flow.complete}
                onCancel={flow.cancel}
            />
        );
    }
    if (flow.kind === "card") {
        return (
            <View style={[styles.stack, style]}>
                {flow.error !== null ? (
                    <Notice tone="danger">{flow.error}</Notice>
                ) : (
                    <Skeleton variant="row" count={1} label={strings.clients.starting} />
                )}
            </View>
        );
    }
    if (flow.kind === "bank") {
        const link = flow.bankLink;
        return (
            <View style={[styles.stack, style]}>
                {link !== null ? (
                    <>
                        {link.texted && flow.textTo !== null ? (
                            <Notice tone="success">{s.bankLinkTexted(flow.textTo)}</Notice>
                        ) : (
                            <Notice tone="info">{s.bankLinkHelp}</Notice>
                        )}
                        <Button
                            onPress={() => {
                                Share.share({ message: link.url }).catch(() => {
                                    flow.setError(s.bankLinkStaffError);
                                });
                            }}
                        >
                            {s.bankLinkShare}
                        </Button>
                    </>
                ) : flow.openBankLink?.verifying === true ? (
                    <Notice tone="info">{flow.openBankLink.note}</Notice>
                ) : (
                    <>
                        <Notice tone="info">{flow.openBankLink?.note ?? s.bankLinkHelp}</Notice>
                        {flow.textTo !== null ? (
                            <Button
                                busy={flow.busy}
                                onPress={() => {
                                    flow.requestBankLink(true);
                                }}
                            >
                                {s.bankLinkText(flow.textTo)}
                            </Button>
                        ) : null}
                        <Button
                            variant="outline"
                            busy={flow.busy}
                            onPress={() => {
                                flow.requestBankLink(false);
                            }}
                        >
                            {s.bankLinkCreate}
                        </Button>
                    </>
                )}
                {link !== null || flow.openBankLink !== null ? (
                    <Button variant="quiet" onPress={flow.revokeBankLink} busy={flow.busy}>
                        {s.bankLinkRevoke}
                    </Button>
                ) : null}
                {flow.error !== null ? <Notice tone="danger">{flow.error}</Notice> : null}
            </View>
        );
    }
    return (
        <View style={[styles.stack, style]}>
            <View style={styles.start}>
                <Button
                    variant="outline"
                    onPress={() => {
                        flow.start("card");
                    }}
                >
                    {strings.clients.addCard}
                </Button>
            </View>
            {allowBank ? (
                <Button
                    variant="outline"
                    onPress={() => {
                        flow.start("bank");
                    }}
                >
                    {strings.clients.addBankWeb}
                </Button>
            ) : null}
            {flow.error !== null ? <Notice tone="danger">{flow.error}</Notice> : null}
        </View>
    );
}

const styles = StyleSheet.create({ start: { gap: 12 }, stack: { gap: 12, paddingTop: 10 } });
