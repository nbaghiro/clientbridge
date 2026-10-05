import { theme } from "@clientbridge/tokens/theme";
import { StyleSheet } from "react-native";

const c = theme.colors;

export const ui = StyleSheet.create({
    panel: {
        backgroundColor: c.surface,
        borderColor: c.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        padding: 16,
    },
    box: {
        marginTop: 10,
        padding: 14,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.bg,
    },
    title: { color: c.ink, fontSize: 16, fontWeight: "700", marginBottom: 12 },
    note: { color: c.muted, fontSize: 12, marginTop: 6, lineHeight: 17 },
    card: { height: 46, marginVertical: 4 },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 14 },
});
