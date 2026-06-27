import { theme } from "@clientbridge/tokens/theme";
import { useStatus } from "@powersync/react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DebugOverlay } from "../components/DebugOverlay";
import { IconChevron, IconSettings, Logo } from "../components/icons";
import type { RootStackParamList } from "../navigation";

export function HomeScreen() {
    const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
    const status = useStatus();
    const connected = status.connected;

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
        <SafeAreaView style={styles.screen} edges={["top"]}>
            <StatusBar style="dark" />
            <View style={styles.topbar}>
                <Pressable onPress={onSecretTap} style={styles.brand}>
                    <Logo size={20} color={theme.colors.accent} />
                    <Text style={styles.wordmark}>Clientbridge</Text>
                </Pressable>
                <Pressable
                    hitSlop={10}
                    onPress={() => {
                        nav.navigate("Settings");
                    }}
                >
                    <IconSettings size={22} color={theme.colors.inkSoft} />
                </Pressable>
            </View>

            <View style={styles.body}>
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

                <Pressable
                    style={styles.linkCard}
                    onPress={() => {
                        nav.navigate("Invoices");
                    }}
                >
                    <Text style={styles.linkLabel}>Invoices</Text>
                    <IconChevron size={18} color={theme.colors.muted} />
                </Pressable>
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
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    topbar: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        paddingVertical: 12,
    },
    brand: { flexDirection: "row", alignItems: "center", gap: 8 },
    wordmark: { color: theme.colors.ink, fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
    body: { paddingHorizontal: 20, paddingTop: 12, gap: 16 },
    title: { color: theme.colors.ink, fontSize: 22, fontWeight: "700", lineHeight: 28 },
    statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    dot: { width: 9, height: 9, borderRadius: 5 },
    status: { color: theme.colors.inkSoft, fontSize: 14, fontWeight: "600" },
    linkCard: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        paddingHorizontal: 16,
        paddingVertical: 16,
    },
    linkLabel: { color: theme.colors.ink, fontSize: 15, fontWeight: "600" },
});
