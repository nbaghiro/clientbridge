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
    label: { color: c.inkSoft, fontSize: 13, fontWeight: "600", marginBottom: 6, marginTop: 14 },
    note: { color: c.muted, fontSize: 12, marginTop: 6, lineHeight: 17 },
    error: { color: c.danFg, fontSize: 13, marginTop: 8 },
    chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 20,
        backgroundColor: c.bg,
        borderWidth: 1,
        borderColor: c.border,
    },
    chipOn: { backgroundColor: c.accent, borderColor: c.accent },
    chipText: { color: c.ink, fontSize: 13, fontWeight: "500" },
    chipTextOn: { color: c.accentInk },
    card: { height: 46, marginVertical: 4 },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 14 },
    cancel: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: theme.radius },
    cancelText: { color: c.inkSoft, fontSize: 14, fontWeight: "600" },
    primary: {
        backgroundColor: c.accent,
        borderRadius: theme.radius,
        paddingHorizontal: 16,
        paddingVertical: 10,
        minWidth: 96,
        alignItems: "center",
    },
    primaryText: { color: c.accentInk, fontSize: 14, fontWeight: "700" },
    outline: {
        alignSelf: "flex-start",
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        marginTop: 10,
    },
    outlineText: { color: c.inkSoft, fontSize: 14, fontWeight: "600" },
    disabled: { opacity: 0.5 },
});
