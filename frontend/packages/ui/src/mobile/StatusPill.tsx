import type { Intent } from "@clientbridge/app-core";
import { INTENT_COLORS } from "@clientbridge/tokens";
import { theme } from "@clientbridge/tokens/theme";
import { StyleSheet, Text, View } from "react-native";

const c = theme.colors;

/** Raw status values are capitalized; `asWritten` keeps an already-worded label as it is. */
export function StatusPill({
    status,
    intent,
    asWritten = false,
}: {
    status: string;
    intent: Intent;
    asWritten?: boolean;
}) {
    const p = INTENT_COLORS[intent];
    const tone = { bg: c[p.soft], fg: c[p.ink] };
    return (
        <View style={[styles.badge, { backgroundColor: tone.bg }]}>
            <Text style={[styles.text, asWritten ? null : styles.raw, { color: tone.fg }]}>
                {status}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    text: { fontSize: 11, fontWeight: "600" },
    raw: { textTransform: "capitalize" },
});
