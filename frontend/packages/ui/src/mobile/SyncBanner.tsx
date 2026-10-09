import type { SyncBannerProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "./Button";
import { Icon } from "./Icon";
import type { NativeProps } from "./props";

const c = theme.colors;
const ICON = { offline: "cloudOff", syncing: "refresh", error: "alert" } as const;

export function SyncBanner({
    state,
    title,
    detail,
    action,
    variant = "strip",
    children,
    style,
}: NativeProps<SyncBannerProps>) {
    const bg = state === "error" ? c.danBg : state === "offline" ? c.warnBg : c.accentWeak;
    const fg = state === "error" ? c.danFg : state === "offline" ? c.warnFg : c.accentStrong;
    return (
        <View
            accessibilityRole="summary"
            style={[variant === "card" ? styles.card : undefined, style]}
        >
            <View
                style={[variant === "strip" ? styles.strip : styles.head, { backgroundColor: bg }]}
            >
                <Icon name={ICON[state]} size={variant === "strip" ? 16 : 20} color={fg} />
                <View style={styles.text}>
                    <Text
                        style={[
                            styles.title,
                            { color: fg },
                            variant === "card" && styles.titleLarge,
                        ]}
                    >
                        {title}
                    </Text>
                    {detail !== undefined ? (
                        <Text
                            style={[styles.detail, { color: fg }]}
                            numberOfLines={variant === "strip" ? 1 : undefined}
                        >
                            {detail}
                        </Text>
                    ) : null}
                    {action !== undefined && variant === "card" ? (
                        <Button
                            size="sm"
                            variant="outline"
                            onPress={action.onPress}
                            style={styles.cardAction}
                        >
                            {action.label}
                        </Button>
                    ) : null}
                </View>
                {action !== undefined && variant === "strip" ? (
                    <Button
                        style={{ alignSelf: "center" }}
                        size="sm"
                        variant="link"
                        onPress={action.onPress}
                    >
                        {action.label}
                    </Button>
                ) : null}
            </View>
            {children !== undefined ? <View style={styles.body}>{children}</View> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    strip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    card: {
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        overflow: "hidden",
    },
    head: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14 },
    text: { flex: 1, minWidth: 0 },
    title: { fontSize: 13.5, fontWeight: "700" },
    titleLarge: { fontSize: 16 },
    detail: { fontSize: 13, marginTop: 1, lineHeight: 18 },
    cardAction: { marginTop: 10 },
    body: { padding: 14 },
});
