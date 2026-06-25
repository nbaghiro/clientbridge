// Pewter-themed mobile shell. Next: expo-router screens (today / calendar / clients / invoice / inbox)
// + PowerSyncContext provider.
import { theme } from "@clientbridge/tokens/theme";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";

export function App() {
    return (
        <SafeAreaView style={styles.screen}>
            <StatusBar style="dark" />
            <View style={styles.card}>
                <Text style={styles.eyebrow}>CLIENTBRIDGE</Text>
                <Text style={styles.title}>The bridge between you and your clients.</Text>
                <Text style={styles.body}>
                    Mobile shell on the Pewter theme. Offline-first via PowerSync (op-sqlite +
                    SQLCipher).
                </Text>
            </View>
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
    eyebrow: { color: theme.colors.accent, fontWeight: "600", fontSize: 12, letterSpacing: 1 },
    title: { color: theme.colors.ink, fontWeight: "700", fontSize: 22, marginTop: 6 },
    body: { color: theme.colors.inkSoft, fontSize: 14, marginTop: 10, lineHeight: 20 },
});
