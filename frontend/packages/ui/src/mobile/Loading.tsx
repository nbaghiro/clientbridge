import { type LoadingProps, strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import type { NativeProps } from "./props";

export function Loading({ label, inline = false, style }: NativeProps<LoadingProps>) {
    return (
        <View
            accessibilityRole="progressbar"
            accessibilityLabel={label ?? strings.common.loading}
            style={[inline ? styles.inline : styles.block, style]}
        >
            <ActivityIndicator color={theme.colors.muted} />
        </View>
    );
}

const styles = StyleSheet.create({
    block: { paddingVertical: 32, alignItems: "center" },
    inline: { paddingVertical: 8, alignItems: "flex-start" },
});
