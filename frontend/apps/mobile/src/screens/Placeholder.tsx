import { strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { StyleSheet, Text, View } from "react-native";

// Pushed stack screens already get a native header with the title, so just center a note.
export function ComingSoon() {
    return (
        <View style={[styles.screen, styles.center]}>
            <Text style={styles.sub}>{strings.common.comingSoon}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
    sub: { color: theme.colors.muted, fontSize: 14 },
});
