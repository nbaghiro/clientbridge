import { type LoadingProps, strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { ActivityIndicator, StyleSheet, View } from "react-native";

export function Loading({ label, inline = false }: LoadingProps) {
    return (
        <View
            accessibilityRole="progressbar"
            accessibilityLabel={label ?? strings.common.loading}
            style={inline ? styles.inline : styles.block}
        >
            <ActivityIndicator color={theme.colors.muted} />
        </View>
    );
}

const styles = StyleSheet.create({
    block: { paddingVertical: 32, alignItems: "center" },
    inline: { paddingVertical: 8, alignItems: "flex-start" },
});
