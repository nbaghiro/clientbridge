import {
    type AddPaymentMethod,
    strings,
    useAsyncAction,
    useStripeAccountId,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import {
    CardField,
    type CardFieldInput,
    StripeProvider,
    useConfirmPayment,
    useConfirmSetupIntent,
} from "@stripe/stripe-react-native";
import { type ReactElement, useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { stripeMerchantId, stripePublishableKey } from "../lib/config";
import { PurchaseConfirmPanel } from "./PurchaseConfirmPanel";

const c = theme.colors;
const URL_SCHEME = "clientbridge";

// NOTE: @stripe/stripe-react-native is a native module — it needs an Expo dev build / EAS build AND a
// real publishable key to run; it does NOT work in Expo Go. tsc passes without either. (POS Terminal
// card-present is a separate hardware-dependent follow — @stripe/stripe-terminal-react-native + a
// reader — and is intentionally left out here.)

/** Root Stripe init for the authed app. The connected account (the single business' Stripe account,
 *  read off the synced `businesses` row) is set on the provider, so every card confirm is a direct
 *  charge on it — matching the web `loadStripe(pk, { stripeAccount })`. No key → render children bare
 *  (the seams below fall back to placeholders). */
export function StripeAppProvider({ children }: { children: ReactElement }) {
    const account = useStripeAccountId();
    if (stripePublishableKey.length === 0) return children;
    // Omit stripeAccountId entirely until the connected account has synced (exactOptionalPropertyTypes).
    const accountProp = account !== null ? { stripeAccountId: account } : {};
    return (
        <StripeProvider
            publishableKey={stripePublishableKey}
            merchantIdentifier={stripeMerchantId}
            urlScheme={URL_SCHEME}
            {...accountProp}
        >
            {children}
        </StripeProvider>
    );
}

const cardStyle: CardFieldInput.Styles = {
    backgroundColor: c.surface,
    textColor: c.ink,
    placeholderColor: c.muted,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: 8,
};

function CardEntry({ onReady }: { onReady: (complete: boolean) => void }) {
    return (
        <CardField
            postalCodeEnabled
            cardStyle={cardStyle}
            style={styles.card}
            onCardChange={(d) => {
                onReady(d.complete);
            }}
        />
    );
}

/** PaymentIntent confirm (package / gift-card purchase, booking deposit) on the connected account
 *  with a newly entered card. Drop-in for the old `PurchaseConfirmPanel` call sites. */
export function CardPaymentConfirm({
    clientSecret,
    onCancel,
    onConfirmed,
}: {
    clientSecret: string;
    onCancel: () => void;
    onConfirmed: () => void;
}) {
    const account = useStripeAccountId();
    if (stripePublishableKey.length === 0 || account === null) {
        return (
            <PurchaseConfirmPanel
                clientSecret={clientSecret}
                onCancel={onCancel}
                onConfirmed={onConfirmed}
            />
        );
    }
    return (
        <PaymentForm clientSecret={clientSecret} onCancel={onCancel} onConfirmed={onConfirmed} />
    );
}

function PaymentForm({
    clientSecret,
    onCancel,
    onConfirmed,
}: {
    clientSecret: string;
    onCancel: () => void;
    onConfirmed: () => void;
}) {
    const { confirmPayment } = useConfirmPayment();
    const [ready, setReady] = useState(false);
    const confirm = useCallback(
        async (cs: string): Promise<void> => {
            const { error } = await confirmPayment(cs, { paymentMethodType: "Card" });
            if (error) throw new Error(error.message);
        },
        [confirmPayment],
    );
    return (
        <PurchaseConfirmPanel
            clientSecret={clientSecret}
            confirm={confirm}
            confirmReady={ready}
            cardField={<CardEntry onReady={setReady} />}
            onCancel={onCancel}
            onConfirmed={onConfirmed}
        />
    );
}

/** SetupIntent confirm (save a card for a client) on the connected account. Rendered by
 *  `AddMethodPanel` for the card flow; the bank/PAD flow keeps its own placeholder. */
export function CardSetupConfirm({ flow }: { flow: AddPaymentMethod }) {
    const intent = flow.intent;
    if (intent === null) return null;
    if (stripePublishableKey.length === 0) {
        return (
            <View style={styles.box}>
                <Text style={styles.title}>{strings.card.addCard}</Text>
                <Text style={styles.note}>{strings.card.entryNotWired}</Text>
                <View style={styles.actions}>
                    <Pressable style={styles.cancel} onPress={flow.cancel}>
                        <Text style={styles.cancelText}>{strings.common.cancel}</Text>
                    </Pressable>
                </View>
            </View>
        );
    }
    return <SetupForm flow={flow} clientSecret={intent.client_secret} />;
}

function SetupForm({ flow, clientSecret }: { flow: AddPaymentMethod; clientSecret: string }) {
    const { confirmSetupIntent } = useConfirmSetupIntent();
    const { busy, error, run } = useAsyncAction();
    const [ready, setReady] = useState(false);

    const submit = (): void => {
        run(
            async () => {
                const { error: confirmError } = await confirmSetupIntent(clientSecret, {
                    paymentMethodType: "Card",
                });
                if (confirmError) throw new Error(confirmError.message);
            },
            {
                onSuccess: flow.complete,
                errorMessage: strings.card.saveError,
            },
        );
    };

    return (
        <View style={styles.box}>
            <Text style={styles.title}>{strings.card.addCard}</Text>
            <CardEntry onReady={setReady} />
            {error !== null ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.actions}>
                <Pressable style={styles.cancel} onPress={flow.cancel} disabled={busy}>
                    <Text style={styles.cancelText}>{strings.common.cancel}</Text>
                </Pressable>
                <Pressable
                    style={[styles.save, (!ready || busy) && styles.disabled]}
                    disabled={!ready || busy}
                    onPress={submit}
                >
                    {busy ? (
                        <ActivityIndicator color={c.accentInk} />
                    ) : (
                        <Text style={styles.saveText}>{strings.card.saveCard}</Text>
                    )}
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    box: {
        marginTop: 10,
        padding: 14,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.bg,
    },
    title: { color: c.ink, fontSize: 15, fontWeight: "700", marginBottom: 8 },
    note: { color: c.muted, fontSize: 12, marginTop: 2, lineHeight: 17 },
    card: { height: 46, marginVertical: 4 },
    error: { color: c.danFg, fontSize: 12, marginTop: 8 },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },
    cancel: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: theme.radius },
    cancelText: { color: c.inkSoft, fontSize: 14, fontWeight: "600" },
    save: {
        backgroundColor: c.accent,
        borderRadius: theme.radius,
        paddingHorizontal: 16,
        paddingVertical: 10,
        minWidth: 96,
        alignItems: "center",
    },
    saveText: { color: c.accentInk, fontSize: 14, fontWeight: "700" },
    disabled: { opacity: 0.5 },
});
