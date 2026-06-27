import { startOnboarding, useConnectStatus } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useState } from "react";
import {
    ActivityIndicator,
    Linking,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { api } from "../lib/api";

export function PaymentsScreen() {
    const status = useConnectStatus(api);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function connect(): Promise<void> {
        setBusy(true);
        setError(null);
        try {
            const { url } = await startOnboarding(api);
            await Linking.openURL(url);
        } catch {
            setError("Couldn't start Stripe onboarding. Please try again.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Text style={styles.note}>
                Take card payments through Stripe and get paid out to your bank.
            </Text>
            <View style={styles.group}>
                {status === null ? (
                    <ActivityIndicator style={styles.loading} color={theme.colors.muted} />
                ) : status.charges_enabled ? (
                    <>
                        <Text style={styles.title}>
                            Payments enabled — you can take card payments.
                        </Text>
                        <Text style={styles.muted}>Connected to Stripe.</Text>
                    </>
                ) : status.connected ? (
                    <>
                        <Text style={styles.title}>
                            Onboarding in progress — finish your Stripe setup.
                        </Text>
                        <ConnectButton
                            busy={busy}
                            label="Continue setup"
                            onPress={() => void connect()}
                        />
                    </>
                ) : (
                    <>
                        <Text style={styles.title}>
                            Connect Stripe to take card payments and get paid out.
                        </Text>
                        <ConnectButton
                            busy={busy}
                            label="Connect Stripe"
                            onPress={() => void connect()}
                        />
                    </>
                )}
                {error !== null && <Text style={styles.error}>{error}</Text>}
            </View>
        </ScrollView>
    );
}

function ConnectButton({
    busy,
    label,
    onPress,
}: {
    busy: boolean;
    label: string;
    onPress: () => void;
}) {
    return (
        <Pressable
            style={[styles.button, busy ? styles.buttonDisabled : null]}
            disabled={busy}
            onPress={onPress}
        >
            {busy ? (
                <ActivityIndicator color={theme.colors.accentInk} />
            ) : (
                <Text style={styles.buttonText}>{label}</Text>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    content: { padding: 16 },
    note: { color: theme.colors.muted, fontSize: 13, marginBottom: 14, lineHeight: 18 },
    loading: { marginVertical: 8 },
    group: {
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: theme.colors.border,
        padding: 16,
    },
    title: { color: theme.colors.ink, fontSize: 15, fontWeight: "500", lineHeight: 20 },
    muted: { color: theme.colors.muted, fontSize: 14, marginTop: 4 },
    button: {
        backgroundColor: theme.colors.accent,
        borderRadius: theme.radius,
        paddingVertical: 12,
        marginTop: 16,
        alignItems: "center",
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: theme.colors.accentInk, fontSize: 15, fontWeight: "600" },
    error: { color: theme.colors.danFg, fontSize: 13, marginTop: 12 },
});
