import { type IconButtonProps, strings } from "@clientbridge/app-core";
import { ON_DATA } from "@clientbridge/tokens";
import { theme } from "@clientbridge/tokens/native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";
import type { NativeProps, WithRef } from "./props";

const c = theme.colors;

export function IconButton({
    icon,
    label,
    onPress,
    badge,
    variant = "quiet",
    size = "md",
    pressed,
    disabled = false,
    style,
    ref,
}: NativeProps<IconButtonProps> & WithRef<View>) {
    const count =
        typeof badge === "number" && badge > 0 ? (badge > 99 ? "99+" : String(badge)) : null;
    const px = size === "sm" ? 34 : 40;
    return (
        <Pressable
            ref={ref}
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={count !== null ? strings.ui.withCount(label, count) : label}
            accessibilityState={{
                disabled,
                ...(pressed === undefined ? {} : { selected: pressed }),
            }}
            hitSlop={6}
            style={[
                styles.base,
                { width: px, height: px },
                variant === "outline" && styles.outline,
                pressed === true && styles.pressed,
                disabled && styles.off,
                style,
            ]}
        >
            <Icon
                name={icon}
                size={size === "sm" ? 18 : 22}
                color={pressed === true ? c.accent : c.inkSoft}
            />
            {count !== null ? (
                <View style={styles.count}>
                    <Text style={styles.countText}>{count}</Text>
                </View>
            ) : badge === true ? (
                <View style={styles.dot} />
            ) : null}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    base: { alignItems: "center", justifyContent: "center", borderRadius: theme.radius },
    outline: { borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
    pressed: { backgroundColor: c.accentWeak },
    off: { opacity: 0.5 },
    count: {
        position: "absolute",
        top: 1,
        right: 0,
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        paddingHorizontal: 4,
        backgroundColor: c.danFg,
        borderWidth: 2,
        borderColor: c.surface,
        alignItems: "center",
        justifyContent: "center",
    },
    countText: { color: ON_DATA, fontSize: 10, fontWeight: "700" },
    dot: {
        position: "absolute",
        top: 8,
        right: 8,
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: c.danFg,
    },
});
