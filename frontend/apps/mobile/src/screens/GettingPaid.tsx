import { strings, useConnectOnboarding } from "@clientbridge/app-core";
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
import { ui } from "@clientbridge/ui";

import { api } from "../lib/api";

export function GettingPaidScreen() {
    const {
        phase,
        busy,
        error,
        headline,
        ctaLabel,
        showCta,
        requirements,
        payoutsEnabled,
        connect,
        refresh,
    } = useConnectOnboarding(api, (url) => {
        Linking.openURL(url).catch(() => undefined);
    });

    useFocusEffect(
        useCallback(() => {
            refresh();
        }, [refresh]),
    );

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Text style={styles.note}>{strings.gettingPaid.subtitle}</Text>
            <View style={styles.group}>
                {phase === "loading" ? (
                    <ActivityIndicator style={styles.loading} color={theme.colors.muted} />
                ) : phase === "error" ? (
                    <Text style={styles.error}>{strings.gettingPaid.loadError}</Text>
                ) : (
                    <>
                        <Text style={phase === "disabled" ? styles.titleDanger : styles.title}>
                            {headline}
                        </Text>
                        {phase === "enabled" && (
                            <Text style={styles.muted}>
                                {payoutsEnabled
                                    ? strings.gettingPaid.payoutsActive
                                    : strings.gettingPaid.payoutsPending}
                            </Text>
                        )}
                        {requirements.map((req) => (
                            <Text key={req} style={styles.requirement}>
                                • {req}
                            </Text>
                        ))}
                        {showCta && (
                            <ConnectButton busy={busy} label={ctaLabel} onPress={connect} />
                        )}
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
            style={[ui.primaryLarge, styles.buttonGap, busy ? styles.buttonDisabled : null]}
            disabled={busy}
            onPress={onPress}
        >
            {busy ? (
                <ActivityIndicator color={theme.colors.accentInk} />
            ) : (
                <Text style={ui.primaryLargeText}>{label}</Text>
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
    titleDanger: { color: theme.colors.danFg, fontSize: 15, fontWeight: "500", lineHeight: 20 },
    requirement: { color: theme.colors.inkSoft, fontSize: 14, marginTop: 6 },
    muted: { color: theme.colors.muted, fontSize: 14, marginTop: 4 },
    buttonGap: { marginTop: 16 },
    buttonDisabled: { opacity: 0.6 },
    error: { color: theme.colors.danFg, fontSize: 13, marginTop: 12 },
});
