import { theme } from "@clientbridge/tokens/theme";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

function PlaceholderScreen({ title }: { title: string }) {
    return (
        <SafeAreaView style={styles.screen} edges={["top"]}>
            <View style={styles.center}>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.sub}>Coming soon.</Text>
            </View>
        </SafeAreaView>
    );
}

export function CalendarScreen() {
    return <PlaceholderScreen title="Calendar" />;
}
export function InboxScreen() {
    return <PlaceholderScreen title="Inbox" />;
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
    title: { color: theme.colors.ink, fontSize: 22, fontWeight: "700" },
    sub: { color: theme.colors.muted, fontSize: 14 },
});
