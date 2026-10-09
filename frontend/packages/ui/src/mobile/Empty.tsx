import type { EmptyProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Logo } from "./Logo";
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
    const content = (
        <View
            style={[
                styles.wrap,
                variant === "card" && styles.card,
                variant === "page" && styles.pageCard,
                style,
            ]}
            accessibilityRole={danger ? "alert" : undefined}
        >
            {icon !== undefined ? (
                <Icon name={icon} size={28} color={c.muted} style={styles.icon} />
            ) : null}
            <Text style={[styles.title, variant === "page" && styles.pageTitle]}>{message}</Text>
            {body !== undefined ? <Text style={styles.body}>{body}</Text> : null}
            {actions !== undefined ? <View style={styles.actions}>{actions}</View> : null}
        </View>
    );
    return variant === "page" ? (
        <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
            <Logo height={32} />
            {content}
        </ScrollView>
    ) : (
        content
    );
}

const styles = StyleSheet.create({
    page: { flex: 1, alignSelf: "stretch", backgroundColor: c.bg },
    pageContent: {
        flexGrow: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 24,
        gap: 24,
    },
    pageCard: {
        width: "100%",
        maxWidth: 440,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 12,
        backgroundColor: c.surface,
        paddingVertical: 32,
    },
    pageTitle: { fontSize: 22, lineHeight: 28 },
    plain: { color: c.muted, textAlign: "center", paddingVertical: 48, fontSize: 14 },
    wrap: { alignItems: "center", paddingVertical: 28, paddingHorizontal: 20 },
    card: {
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: c.border,
        borderRadius: 12,
        backgroundColor: c.surface,
    },
    icon: { marginBottom: 10 },
    title: { color: c.ink, fontSize: 16, fontWeight: "700", textAlign: "center" },
    body: { color: c.muted, fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 4 },
    actions: {
        alignSelf: "stretch",
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: 8,
        marginTop: 16,
    },
});
