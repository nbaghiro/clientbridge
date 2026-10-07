import { type LoadingProps, strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import type { NativeProps } from "./props";

export function Loading({ label, inline = false, style }: NativeProps<LoadingProps>) {
    return (
        <View
            accessibilityRole="progressbar"
            accessibilityLabel={label ?? strings.common.loading}
            style={[inline ? styles.inline : styles.block, style]}
        >
            <ActivityIndicator color={theme.colors.muted} />
            {label !== undefined ? (
                <Text style={styles.label} numberOfLines={2}>
                    {label}
                </Text>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    block: { paddingVertical: 32, alignItems: "center", gap: 8 },
    inline: { paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 },
    label: { color: theme.colors.muted, fontSize: 14, textAlign: "center" },
});
