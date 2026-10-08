import type { OptionCardProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";
import type { NativeProps, WithRef } from "./props";

const c = theme.colors;

export function OptionCard({
    title,
    subtitle,
    detail,
    leading,
    trailing,
    footer,
    selected,
    onPress,
    disabled,
    layout = "row",
    size = "md",
    label,
    style,
    ref,
}: NativeProps<OptionCardProps> & WithRef<View>) {
    const pad = size === "lg" ? 16 : size === "sm" ? 8 : 12;
    return (
        <Pressable
            ref={ref}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected, disabled: disabled === true }}
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [
                styles.base,
                layout === "row" ? [styles.row, { padding: pad }] : styles.stack,
                selected === true && styles.selected,
                (disabled === true || pressed) && styles.dim,
                style,
            ]}
        >
            {leading !== undefined ? (
                <View style={layout === "stack" ? styles.media : undefined}>{leading}</View>
            ) : null}
            <View style={[styles.content, layout === "stack" && { padding: pad }]}>
                <View style={styles.copy}>
                    <Text
                        style={[
                            styles.title,
                            { fontSize: size === "lg" ? 16 : size === "sm" ? 14 : 15 },
                        ]}
                    >
                        {title}
                    </Text>
                    {subtitle !== undefined ? (
                        <Text style={styles.subtitle}>{subtitle}</Text>
                    ) : null}
                    {detail !== undefined ? (
                        <Text numberOfLines={2} style={styles.detail}>
                            {detail}
                        </Text>
                    ) : null}
                    {footer !== undefined ? <View style={styles.footer}>{footer}</View> : null}
                </View>
                {trailing !== undefined ? <View>{trailing}</View> : null}
            </View>
            {selected !== undefined &&
            size !== "sm" &&
            !(layout === "row" && trailing !== undefined) ? (
                <View accessible={false} style={[styles.check, selected && styles.checkOn]}>
                    {selected ? <Icon name="check" size={12} color={c.accentInk} /> : null}
                </View>
            ) : null}
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
    },
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    stack: { overflow: "hidden" },
    media: { width: "100%" },
    content: { flexDirection: "row", alignItems: "flex-start", gap: 12, flex: 1, minWidth: 0 },
    copy: { flex: 1, minWidth: 0 },
    title: { fontWeight: "600", color: c.ink },
    subtitle: { marginTop: 2, fontSize: 13, color: c.muted },
    detail: { marginTop: 6, fontSize: 13, lineHeight: 20, color: c.inkSoft },
    footer: { marginTop: 8 },
    selected: { borderColor: c.accent, backgroundColor: c.accentWeak },
    dim: { opacity: 0.6 },
    check: {
        position: "absolute",
        right: 10,
        top: 10,
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        alignItems: "center",
        justifyContent: "center",
    },
    checkOn: { borderColor: c.accent, backgroundColor: c.accent },
});
