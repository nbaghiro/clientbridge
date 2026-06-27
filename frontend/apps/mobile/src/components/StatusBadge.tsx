import type { Intent } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { StyleSheet, Text, View } from "react-native";

const c = theme.colors;

const INTENT_COLORS: Record<Intent, { bg: string; fg: string }> = {
    accent: { bg: c.accentWeak, fg: c.accentStrong },
    success: { bg: c.okBg, fg: c.okFg },
    warning: { bg: c.warnBg, fg: c.warnFg },
    danger: { bg: c.danBg, fg: c.danFg },
    neutral: { bg: c.bg, fg: c.muted },
};

export function StatusBadge({ status, intent }: { status: string; intent: Intent }) {
    const tone = INTENT_COLORS[intent];
    return (
        <View style={[styles.badge, { backgroundColor: tone.bg }]}>
            <Text style={[styles.text, { color: tone.fg }]}>{status}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    text: { fontSize: 11, fontWeight: "600", textTransform: "capitalize" },
});
