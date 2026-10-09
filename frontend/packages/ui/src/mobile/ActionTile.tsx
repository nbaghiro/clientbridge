import type { ActionTileProps } from "@clientbridge/app-core";
import { ON_DATA, tintHex } from "@clientbridge/tokens";
import { theme } from "@clientbridge/tokens/native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";
import type { NativeProps, WithRef } from "./props";

const c = theme.colors;

export function ActionTile({
    icon,
    label,
    hint,
    onPress,
    disabled,
    layout = "tile",
    variant = "plain",
    style,
    ref,
}: NativeProps<ActionTileProps> & WithRef<View>) {
    const inverse = variant === "inverse";
    return (
        <Pressable
            ref={ref}
            accessibilityRole="button"
            accessibilityState={{ disabled: disabled === true }}
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [
                styles.base,
                layout === "row" ? styles.row : styles.tile,
                inverse && styles.inverse,
                (disabled === true || pressed) && styles.dim,
                style,
            ]}
        >
            <Icon name={icon} size={22} color={inverse ? ON_DATA : c.inkSoft} />
            <View style={styles.copy}>
                <Text
                    style={[
                        styles.label,
                        inverse && styles.inverseText,
                        layout === "tile" && styles.center,
                    ]}
                >
                    {label}
                </Text>
                {hint !== undefined ? (
                    <Text
                        numberOfLines={1}
                        style={[
                            styles.hint,
                            inverse && styles.inverseText,
                            layout === "tile" && styles.center,
                        ]}
                    >
                        {hint}
                    </Text>
                ) : null}
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    base: {
        minWidth: 0,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        gap: 8,
        alignItems: "center",
    },
    row: { flexDirection: "row", padding: 14, gap: 12 },
    tile: { paddingVertical: 14, paddingHorizontal: 8 },
    inverse: { borderColor: tintHex(ON_DATA, 20), backgroundColor: tintHex(ON_DATA, 10) },
    copy: { minWidth: 0, flexShrink: 1 },
    label: { fontSize: 13, fontWeight: "600", color: c.ink },
    hint: { marginTop: 2, fontSize: 12, color: c.muted },
    center: { textAlign: "center" },
    inverseText: { color: ON_DATA },
    dim: { opacity: 0.6 },
});
