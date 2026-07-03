import { strings, useAsyncAction } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

const c = theme.colors;

/** The native purchase card seam: confirming a package / gift-card / deposit PaymentIntent. The
 *  Stripe-aware wrapper (`components/stripe.tsx`) injects `confirm` (from `useConfirmPayment`) plus
 *  the SDK `CardField` node and the card-complete flag. With no `confirm` (e.g. no publishable key)
 *  it falls back to a disabled Confirm + a clear placeholder. */
export function PurchaseConfirmPanel({
    clientSecret,
    onCancel,
    onConfirmed,
    confirm,
    cardField,
    confirmReady = false,
}: {
    clientSecret: string;
    onCancel: () => void;
    onConfirmed: () => void;
    confirm?: (clientSecret: string) => Promise<void>;
    cardField?: ReactNode;
    confirmReady?: boolean;
}) {
    const { busy, error, run } = useAsyncAction();
    const wired = confirm !== undefined;

    const runConfirm = (): void => {
        if (confirm === undefined) return;
        run(() => confirm(clientSecret), {
            onSuccess: onConfirmed,
            errorMessage: strings.purchase.confirmError,
        });
    };

    return (
        <View style={styles.box}>
            <Text style={styles.title}>{strings.purchase.title}</Text>
            {wired ? (
                cardField
            ) : (
                <>
                    <Text style={styles.note}>{strings.purchase.notWired}</Text>
                    <Text style={styles.secret} numberOfLines={1}>
                        {strings.purchase.paymentIntentLabel} {clientSecret}
                    </Text>
                </>
            )}
            {error !== null ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.actions}>
                <Pressable style={styles.cancel} onPress={onCancel} disabled={busy}>
                    <Text style={styles.cancelText}>{strings.purchase.back}</Text>
                </Pressable>
                <Pressable
                    style={[styles.save, (!wired || !confirmReady || busy) && styles.disabled]}
                    disabled={!wired || !confirmReady || busy}
                    onPress={runConfirm}
                >
                    {busy ? (
                        <ActivityIndicator color={c.accentInk} />
                    ) : (
                        <Text style={styles.saveText}>{strings.purchase.confirm}</Text>
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
    title: { color: c.ink, fontSize: 15, fontWeight: "700" },
    note: { color: c.muted, fontSize: 12, marginTop: 6, lineHeight: 17 },
    secret: { color: c.muted, fontSize: 11, marginTop: 8 },
    error: { color: c.danFg, fontSize: 12, marginTop: 8 },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },
    cancel: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: theme.radius },
    cancelText: { color: c.inkSoft, fontSize: 14, fontWeight: "600" },
    save: {
        backgroundColor: c.accent,
        borderRadius: theme.radius,
        paddingHorizontal: 16,
        paddingVertical: 10,
        minWidth: 88,
        alignItems: "center",
    },
    saveText: { color: c.accentInk, fontSize: 14, fontWeight: "700" },
    disabled: { opacity: 0.5 },
});
