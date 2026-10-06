import type { PanelProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";

import type { NativeProps } from "./props";

const c = theme.colors;

export function Panel({
    title,
    subtitle,
    actions,
    flush = false,
    children,
    style,
}: NativeProps<PanelProps>) {
    const head = title !== undefined || subtitle !== undefined || actions !== undefined;
    return (
        <View style={[styles.panel, !flush && styles.padded, style]}>
            {head ? (
                <View style={[styles.head, flush && styles.flushHead]}>
                    <View style={styles.headText}>
                        {title !== undefined ? <Text style={styles.title}>{title}</Text> : null}
                        {subtitle !== undefined ? (
                            <Text style={styles.subtitle}>{subtitle}</Text>
                        ) : null}
                    </View>
                    {actions !== undefined ? <View style={styles.actions}>{actions}</View> : null}
                </View>
            ) : null}
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    panel: {
        backgroundColor: c.surface,
        borderColor: c.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        overflow: "hidden",
    },
    padded: { padding: 16 },
    head: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 10 },
    flushHead: {
        marginBottom: 0,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomColor: c.border,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    headText: { flex: 1 },
    title: { color: c.ink, fontSize: 16, fontWeight: "700" },
    subtitle: { color: c.muted, fontSize: 13, marginTop: 2 },
    actions: { flexDirection: "row", alignItems: "center", gap: 8 },
});
