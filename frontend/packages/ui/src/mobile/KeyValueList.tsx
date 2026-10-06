import type { KeyValueListProps } from "@clientbridge/app-core";
import { INTENT_COLORS } from "@clientbridge/tokens";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";

import type { NativeProps } from "./props";

const c = theme.colors;
const WIDTH = { 2: "50%", 3: "33.333%", 4: "25%" } as const;

export function KeyValueList({
    rows,
    layout = "inline",
    columns = 2,
    style,
}: NativeProps<KeyValueListProps>) {
    const cell: ViewStyle = { width: WIDTH[columns] };
    return (
        <View style={[layout === "stack" ? styles.grid : undefined, style]}>
            {rows.map((row, i) => {
                const tint = row.intent ? { color: c[INTENT_COLORS[row.intent].ink] } : undefined;
                return layout === "stack" ? (
                    <View key={row.label} style={[styles.cell, cell]}>
                        <Text style={styles.stackLabel}>{row.label}</Text>
                        <Text style={[styles.value, tint]} numberOfLines={1}>
                            {row.value}
                        </Text>
                    </View>
                ) : (
                    <View key={row.label} style={[styles.row, i > 0 && styles.divider]}>
                        <Text style={styles.label}>{row.label}</Text>
                        <Text style={[styles.value, styles.right, tint]}>{row.value}</Text>
                    </View>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    grid: { flexDirection: "row", flexWrap: "wrap", rowGap: 14 },
    cell: { paddingRight: 12 },
    row: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "baseline",
        paddingVertical: 10,
        gap: 12,
    },
    divider: { borderTopColor: c.borderSoft, borderTopWidth: StyleSheet.hairlineWidth },
    label: { color: c.muted, fontSize: 14 },
    stackLabel: {
        color: c.muted,
        fontSize: 11,
        fontWeight: "600",
        letterSpacing: 0.4,
        textTransform: "uppercase",
    },
    value: { color: c.ink, fontSize: 14, fontWeight: "600", marginTop: 3 },
    right: { textAlign: "right", flexShrink: 1, marginTop: 0 },
});
