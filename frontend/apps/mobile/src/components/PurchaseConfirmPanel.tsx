import { theme } from "@clientbridge/tokens/theme";
import { Pressable, StyleSheet, Text, View } from "react-native";

const c = theme.colors;

/** The native purchase card seam: confirming a package/gift-card PaymentIntent needs the native
 *  Stripe SDK (the follow), injected via `confirm` and wired to the purchase form's `complete` —
 *  mirroring `AddMethodPanel`. Undefined (this build) → a disabled Confirm + a clear placeholder. */
export function PurchaseConfirmPanel({
    clientSecret,
    onCancel,
    onConfirmed,
    confirm,
}: {
    clientSecret: string;
    onCancel: () => void;
    onConfirmed: () => void;
    confirm?: (clientSecret: string) => Promise<void>;
}) {
    const runConfirm = (): void => {
        if (confirm === undefined) return;
        void confirm(clientSecret).then(onConfirmed);
    };

    return (
        <View style={styles.box}>
            <Text style={styles.title}>Confirm payment</Text>
            <Text style={styles.note}>
                Card entry needs the native Stripe SDK (not wired in this build). Charge a saved
                card instead, or finish on the web app.
            </Text>
            <Text style={styles.secret} numberOfLines={1}>
                PaymentIntent: {clientSecret}
            </Text>
            <View style={styles.actions}>
                <Pressable style={styles.cancel} onPress={onCancel}>
                    <Text style={styles.cancelText}>Back</Text>
                </Pressable>
                <Pressable
                    style={[styles.save, confirm === undefined && styles.disabled]}
                    disabled={confirm === undefined}
                    onPress={runConfirm}
                >
                    <Text style={styles.saveText}>Confirm</Text>
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
