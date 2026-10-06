import type { RatingDistributionProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";

const c = theme.colors;

export function RatingDistribution({ rows, label }: RatingDistributionProps) {
    const max = Math.max(1, ...rows.map((r) => r.count));
    return (
        <View style={styles.list}>
            {rows.map((r) => (
                <View
                    key={r.stars}
                    style={styles.row}
                    accessible
                    accessibilityLabel={label(r.stars, r.count)}
                >
                    <Text style={styles.stars}>{r.stars}★</Text>
                    <View style={styles.track}>
                        <View style={[styles.fill, { width: `${(r.count / max) * 100}%` }]} />
                    </View>
                    <Text style={styles.count}>{r.count}</Text>
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    list: { gap: 6 },
    row: { flexDirection: "row", alignItems: "center", gap: 8 },
    stars: { width: 24, color: c.muted, fontSize: 12 },
    track: {
        flex: 1,
        height: 8,
        borderRadius: 999,
        backgroundColor: c.surface2,
        overflow: "hidden",
    },
    fill: { height: "100%", borderRadius: 999, backgroundColor: c.accent },
    count: { width: 16, textAlign: "right", color: c.muted, fontSize: 12 },
});
