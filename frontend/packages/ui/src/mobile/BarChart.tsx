import type { BarChartProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

const c = theme.colors;
const percent = (fraction: number): `${number}%` => `${fraction * 100}%`;

export function BarChart({ bars, label, height = 140 }: BarChartProps) {
    const max = Math.max(1, ...bars.map((b) => b.value));
    const last = bars.filter((b) => !b.partial && !b.dim).at(-1)?.key ?? bars.at(-1)?.key ?? null;
    const [picked, setPicked] = useState<string | null>(last);
    const shown = bars.find((b) => b.key === picked);
    return (
        <View accessible accessibilityLabel={label}>
            <Text style={styles.readout}>
                {shown ? `${shown.label}  ${shown.valueLabel}` : " "}
            </Text>
            <View style={[styles.plot, { height }]}>
                {bars.map((b) => (
                    <Pressable
                        key={b.key}
                        style={styles.slot}
                        accessibilityRole="button"
                        accessibilityLabel={`${b.label}: ${b.valueLabel}`}
                        onPress={() => {
                            setPicked(b.key);
                        }}
                    >
                        <View
                            style={[
                                styles.bar,
                                { height: percent(Math.max(0.02, b.value / max)) },
                                b.dim ? styles.dim : null,
                                b.partial ? styles.partial : null,
                                b.key === picked ? styles.picked : null,
                            ]}
                        />
                    </Pressable>
                ))}
            </View>
            <View style={styles.axis}>
                {bars.map((b) => (
                    <Text key={b.key} style={styles.tick}>
                        {b.label.slice(0, 1)}
                    </Text>
                ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    readout: {
        color: c.ink,
        fontSize: 13,
        fontWeight: "600",
        marginBottom: 8,
        fontVariant: ["tabular-nums"],
    },
    plot: {
        flexDirection: "row",
        alignItems: "flex-end",
        gap: 2,
        borderBottomWidth: 1,
        borderBottomColor: c.border,
    },
    slot: { flex: 1, height: "100%", justifyContent: "flex-end", alignItems: "center" },
    bar: {
        width: "100%",
        maxWidth: 26,
        backgroundColor: c.accent,
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
    },
    dim: { backgroundColor: c.accentLine },
    partial: { opacity: 0.5 },
    picked: { backgroundColor: c.accentStrong },
    axis: { flexDirection: "row", gap: 2, marginTop: 5 },
    tick: { flex: 1, textAlign: "center", color: c.muted, fontSize: 11 },
});
