import type { ButtonProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

const c = theme.colors;

export function Button({
    children,
    onPress,
    variant = "primary",
    size = "md",
    disabled = false,
    busy = false,
    full = false,
    grow = false,
    icon,
    label,
}: ButtonProps) {
    const off = disabled || busy;
    return (
        <Pressable
            onPress={onPress}
            disabled={off}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled: off, busy }}
            style={({ pressed }) => [
                styles.base,
                BOX[variant],
                variant === "link" ? styles.linkBox : SIZE[size],
                full && styles.full,
                grow && styles.grow,
                (off || pressed) && styles.dim,
            ]}
        >
            {busy ? (
                <ActivityIndicator
                    size="small"
                    color={variant === "primary" ? c.accentInk : c.inkSoft}
                />
            ) : icon !== undefined ? (
                <View>{icon}</View>
            ) : null}
            {typeof children === "string" || typeof children === "number" ? (
                <Text style={[styles.text, TEXT[variant], TEXT_SIZE[size]]}>{children}</Text>
            ) : (
                children
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    base: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        borderRadius: theme.radius,
        alignSelf: "flex-start",
    },
    full: { alignSelf: "stretch" },
    grow: { flex: 1, alignSelf: "auto" },
    dim: { opacity: 0.6 },
    linkBox: { paddingVertical: 4 },
    text: { fontWeight: "600" },
});

const BOX = StyleSheet.create({
    primary: { backgroundColor: c.accent },
    outline: { borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
    quiet: {},
    danger: { borderWidth: 1, borderColor: c.danFg },
    link: {},
});

const SIZE = StyleSheet.create({
    sm: { paddingHorizontal: 12, paddingVertical: 6, minHeight: 32 },
    md: { paddingHorizontal: 16, paddingVertical: 10, minHeight: 42 },
    lg: { paddingHorizontal: 18, paddingVertical: 15 },
});

const TEXT = StyleSheet.create({
    primary: { color: c.accentInk, fontWeight: "700" },
    outline: { color: c.inkSoft },
    quiet: { color: c.inkSoft },
    danger: { color: c.danFg },
    link: { color: c.accent },
});

const TEXT_SIZE = StyleSheet.create({
    sm: { fontSize: 13 },
    md: { fontSize: 14 },
    lg: { fontSize: 15 },
});
