import { type DetailSectionProps, type DetailViewProps, strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { StatusPill } from "./StatusPill";
import { Modal } from "./Modal";

const c = theme.colors;

export function DetailView({
    open,
    title,
    subtitle,
    status,
    leading,
    onClose,
    actions,
    children,
}: DetailViewProps) {
    return (
        <Modal open={open} onClose={onClose}>
            <View style={styles.head}>
                <View style={styles.headMain}>
                    {leading}
                    <View style={styles.headText}>
                        <Text style={styles.title} numberOfLines={1}>
                            {title}
                        </Text>
                        {subtitle !== undefined ? (
                            <Text style={styles.subtitle} numberOfLines={1}>
                                {subtitle}
                            </Text>
                        ) : null}
                    </View>
                </View>
                {status !== undefined ? (
                    <StatusPill status={status.status} intent={status.intent} />
                ) : null}
            </View>
            <ScrollView
                style={styles.body}
                contentContainerStyle={styles.bodyContent}
                keyboardShouldPersistTaps="handled"
            >
                {children}
            </ScrollView>
            <View style={styles.footer}>
                {actions}
                <Pressable style={styles.close} onPress={onClose}>
                    <Text style={styles.closeText}>{strings.common.close}</Text>
                </Pressable>
            </View>
        </Modal>
    );
}

export function DetailSection({ title, action, children }: DetailSectionProps) {
    return (
        <View style={styles.section}>
            {title !== undefined || action !== undefined ? (
                <View style={styles.sectionHead}>
                    {title !== undefined ? (
                        <Text style={styles.sectionLabel}>{title}</Text>
                    ) : (
                        <View />
                    )}
                    {action}
                </View>
            ) : null}
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    head: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 12,
    },
    headMain: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
    headText: { flex: 1 },
    title: { color: c.ink, fontSize: 18, fontWeight: "700" },
    subtitle: { color: c.muted, fontSize: 13, marginTop: 2 },
    body: { flexGrow: 0 },
    bodyContent: { paddingBottom: 8 },
    footer: {
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 8,
        marginTop: 12,
    },
    close: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: theme.radius },
    closeText: { color: c.inkSoft, fontSize: 15, fontWeight: "600" },
    section: { marginTop: 14 },
    sectionHead: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 4,
    },
    sectionLabel: {
        color: c.muted,
        fontSize: 11,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
});
