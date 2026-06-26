// Barebones home screen — live PowerSync status. Tap the wordmark 5× to open the debug view.
import { theme } from "@clientbridge/tokens/theme";
import { useStatus } from "@powersync/react";
import { StatusBar } from "expo-status-bar";
import { useRef, useState } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";

import { DebugOverlay } from "../components/DebugOverlay";
import { Logo } from "../components/icons";

export function HomeScreen() {
    const status = useStatus();
    const connected = status.connected;
    const lastSynced = status.lastSyncedAt;

    const [debugOpen, setDebugOpen] = useState(false);
    const taps = useRef<number[]>([]);
    const onSecretTap = (): void => {
        const now = Date.now();
        taps.current = [...taps.current, now].filter((t) => now - t < 1500);
        if (taps.current.length >= 5) {
            taps.current = [];
            setDebugOpen(true);
        }
    };

    return (
        <SafeAreaView style={styles.screen}>
            <StatusBar style="dark" />
            <View style={styles.card}>
                <Pressable onPress={onSecretTap} style={styles.brand}>
                    <Logo size={18} color={theme.colors.accent} />
                    <Text style={styles.eyebrow}>CLIENTBRIDGE</Text>
                </Pressable>
                <Text style={styles.title}>The bridge between you and your clients.</Text>

                <View style={styles.statusRow}>
                    <View
                        style={[
                            styles.dot,
                            {
                                backgroundColor: connected
                                    ? theme.colors.success
                                    : theme.colors.muted,
                            },
                        ]}
                    />
                    <Text style={styles.status}>
                        PowerSync · {connected ? "connected" : "offline"}
                    </Text>
                </View>

                <Text style={styles.body}>
                    {lastSynced
                        ? `Last synced at ${lastSynced.toLocaleTimeString()}`
                        : "Waiting for first sync…"}
                </Text>
            </View>
            <DebugOverlay
                visible={debugOpen}
                onClose={() => {
                    setDebugOpen(false);
                }}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: theme.colors.bg,
        justifyContent: "center",
        padding: 24,
    },
    card: {
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        padding: 24,
    },
    brand: { flexDirection: "row", alignItems: "center", gap: 7 },
    eyebrow: { color: theme.colors.accent, fontWeight: "600", fontSize: 12, letterSpacing: 1 },
    title: { color: theme.colors.ink, fontWeight: "700", fontSize: 22, marginTop: 6 },
    statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16 },
    dot: { width: 9, height: 9, borderRadius: 5 },
    status: { color: theme.colors.inkSoft, fontSize: 14, fontWeight: "600" },
    body: { color: theme.colors.muted, fontSize: 13, marginTop: 8, lineHeight: 19 },
});
