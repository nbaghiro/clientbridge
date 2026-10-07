import type { ButtonProps } from "@clientbridge/app-core";
import { ON_DATA, tintHex } from "@clientbridge/tokens";
import { theme } from "@clientbridge/tokens/native";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";
import type { NativeProps, WithRef } from "./props";

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
    tone = "default",
    style,
    ref,
}: NativeProps<ButtonProps> & WithRef<View>) {
    const off = disabled || busy;
    const inverse = tone === "inverse";
    return (
        <Pressable
            ref={ref}
            onPress={onPress}
            disabled={off}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled: off, busy }}
            style={({ pressed }) => [
                styles.base,
                inverse ? INVERSE_BOX[variant] : BOX[variant],
                variant === "link" ? styles.linkBox : SIZE[size],
                full && styles.full,
                grow && styles.grow,
                inverse && pressed && INVERSE_PRESSED_BOX[variant],
                (off || (pressed && !inverse)) && styles.dim,
                style,
            ]}
        >
            {({ pressed }) => {
                const text = inverse
                    ? pressed
                        ? INVERSE_PRESSED_TEXT[variant]
                        : INVERSE_TEXT[variant]
                    : TEXT[variant];
                const ink = text.color;
                return (
                    <>
                        {busy ? (
                            <ActivityIndicator size="small" color={ink} />
                        ) : typeof icon === "string" ? (
                            <Icon name={icon} size={size === "sm" ? 15 : 17} color={ink} />
                        ) : icon !== undefined ? (
                            <View>{icon}</View>
                        ) : null}
                        {typeof children === "string" || typeof children === "number" ? (
                            <Text style={[styles.text, text, TEXT_SIZE[size]]}>{children}</Text>
                        ) : (
                            children
                        )}
                    </>
                );
            }}
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

const INVERSE_BOX = StyleSheet.create({
    primary: { backgroundColor: c.surface },
    outline: { borderWidth: 1, borderColor: tintHex(ON_DATA, 60) },
    quiet: {},
    danger: { backgroundColor: c.surface },
    link: {},
});

const INVERSE_PRESSED_BOX = StyleSheet.create({
    primary: { opacity: 0.85 },
    outline: { backgroundColor: c.surface, borderColor: c.surface },
    quiet: { backgroundColor: tintHex(ON_DATA, 15) },
    danger: { backgroundColor: c.danFg },
    link: {},
});

const INVERSE_TEXT = StyleSheet.create({
    primary: { color: c.ink, fontWeight: "700" },
    outline: { color: ON_DATA },
    quiet: { color: ON_DATA },
    danger: { color: c.danFg },
    link: { color: ON_DATA },
});

const INVERSE_PRESSED_TEXT = StyleSheet.create({
    primary: { color: c.ink, fontWeight: "700" },
    outline: { color: c.ink },
    quiet: { color: ON_DATA },
    danger: { color: ON_DATA },
    link: { color: ON_DATA, textDecorationLine: "underline" },
});

const TEXT_SIZE = StyleSheet.create({
    sm: { fontSize: 13 },
    md: { fontSize: 14 },
    lg: { fontSize: 15 },
});
