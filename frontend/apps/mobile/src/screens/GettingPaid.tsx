import { strings, useConnectOnboarding } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Loading, Notice, Panel } from "@clientbridge/ui";

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
            <Panel>
                {phase === "loading" ? (
                    <Loading inline />
                ) : phase === "error" ? (
                    <Notice tone="danger">{strings.gettingPaid.loadError}</Notice>
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
                            <View style={styles.buttonGap}>
                                <Button size="lg" full busy={busy} onPress={connect}>
                                    {ctaLabel}
                                </Button>
                            </View>
                        )}
                    </>
                )}
                {error !== null && <Notice tone="danger">{error}</Notice>}
            </Panel>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    content: { padding: 16 },
    note: { color: theme.colors.muted, fontSize: 13, marginBottom: 14, lineHeight: 18 },
    title: { color: theme.colors.ink, fontSize: 15, fontWeight: "500", lineHeight: 20 },
    titleDanger: { color: theme.colors.danFg, fontSize: 15, fontWeight: "500", lineHeight: 20 },
    requirement: { color: theme.colors.inkSoft, fontSize: 14, marginTop: 6 },
    muted: { color: theme.colors.muted, fontSize: 14, marginTop: 4 },
    buttonGap: { marginTop: 16 },
});
