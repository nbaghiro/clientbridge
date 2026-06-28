import { useConnectOnboarding } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback } from "react";
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
    const { phase, busy, error, ctaLabel, connect, refresh } = useConnectOnboarding(api, (url) => {
        void Linking.openURL(url);
    });

    useFocusEffect(
        useCallback(() => {
            refresh();
        }, [refresh]),
    );

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Text style={styles.note}>
                Take card payments through Stripe and get paid out to your bank.
            </Text>
            <View style={styles.group}>
                {phase === "loading" ? (
                    <ActivityIndicator style={styles.loading} color={theme.colors.muted} />
                ) : phase === "error" ? (
                    <Text style={styles.error}>
                        We couldn’t load your payment status. Please try again.
                    </Text>
                ) : phase === "enabled" ? (
                    <>
                        <Text style={styles.title}>
                            Payments enabled — you can take card payments.
                        </Text>
                        <Text style={styles.muted}>Connected to Stripe.</Text>
                    </>
                ) : (
                    <>
                        <Text style={styles.title}>
                            {phase === "in_progress"
                                ? "Onboarding in progress — finish your Stripe setup."
                                : "Connect Stripe to take card payments and get paid out."}
                        </Text>
                        <ConnectButton busy={busy} label={ctaLabel} onPress={connect} />
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
