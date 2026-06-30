import { theme } from "@clientbridge/tokens/theme";
import { Pressable, StyleSheet, Text, View } from "react-native";

const c = theme.colors;

/** The native purchase card seam: confirming a package/gift-card PaymentIntent needs the native
 *  Stripe SDK (the follow). It isn't wired here, so we surface the secret + a clear placeholder —
 *  mirroring the saved-card / POS Terminal seams. A saved card charges off-session without this. */
export function PurchaseConfirmPanel({
    clientSecret,
    onCancel,
}: {
    clientSecret: string;
    onCancel: () => void;
}) {
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
});
