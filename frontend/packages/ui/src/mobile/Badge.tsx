import type { BadgeProps } from "@clientbridge/app-core";
import { INTENT_COLORS } from "@clientbridge/tokens";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";

const c = theme.colors;

export function Badge({ label, intent = "accent", kind = "pill" }: BadgeProps) {
    if (kind === "count") {
        return (
            <View style={styles.count}>
                <Text style={styles.countText}>{label}</Text>
            </View>
        );
    }
    const p = INTENT_COLORS[intent];
    const tone = { bg: c[p.soft], fg: c[p.ink] };
    return (
        <View style={[styles.pill, { backgroundColor: tone.bg }]}>
            <Text style={[styles.pillText, { color: tone.fg }]}>{label}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: "flex-start" },
    pillText: { fontSize: 11, fontWeight: "600" },
    count: {
        minWidth: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: c.accent,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 5,
    },
    countText: { color: c.accentInk, fontSize: 11, fontWeight: "700" },
});
