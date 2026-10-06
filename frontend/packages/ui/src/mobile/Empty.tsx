import type { EmptyProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";
import type { NativeProps } from "./props";

const c = theme.colors;

export function Empty({
    message,
    body,
    icon,
    actions,
    intent = "neutral",
    variant = "inline",
    style,
}: NativeProps<EmptyProps>) {
    if (
        body === undefined &&
        icon === undefined &&
        actions === undefined &&
        intent === "neutral" &&
        variant === "inline"
    ) {
        return <Text style={[styles.plain, style]}>{message}</Text>;
    }
    const danger = intent === "danger";
    return (
        <View
            style={[styles.wrap, variant === "card" && styles.card, style]}
            accessibilityRole={danger ? "alert" : undefined}
        >
            {icon !== undefined ? (
                <View style={[styles.icon, { backgroundColor: danger ? c.danBg : c.accentWeak }]}>
                    <Icon name={icon} size={21} color={danger ? c.danFg : c.accent} />
                </View>
            ) : null}
            <Text style={styles.title}>{message}</Text>
            {body !== undefined ? <Text style={styles.body}>{body}</Text> : null}
            {actions !== undefined ? <View style={styles.actions}>{actions}</View> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    plain: { color: c.muted, textAlign: "center", paddingVertical: 48, fontSize: 14 },
    wrap: { alignItems: "center", paddingVertical: 28, paddingHorizontal: 20 },
    card: {
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: c.border,
        borderRadius: 12,
        backgroundColor: c.surface,
    },
    icon: {
        width: 46,
        height: 46,
        borderRadius: 23,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 12,
    },
    title: { color: c.ink, fontSize: 16, fontWeight: "700", textAlign: "center" },
    body: { color: c.muted, fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 4 },
    actions: { alignSelf: "stretch", gap: 8, marginTop: 16 },
});
