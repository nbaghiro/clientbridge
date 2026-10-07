import { type StatProps, formatMoney, formatMoneyWithCurrency } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";

import type { NativeProps } from "./props";

const c = theme.colors;

const TONE = {
    ink: c.ink,
    muted: c.muted,
    success: c.success,
    warning: c.warnFg,
    danger: c.danFg,
} as const;

export function Stat({
    label,
    cents,
    value,
    tone = "ink",
    hint,
    size = "md",
    currency,
    style,
}: NativeProps<StatProps>) {
    const large = size === "lg";
    const money = (n: number): string =>
        currency === undefined ? formatMoney(n) : formatMoneyWithCurrency(n, currency);
    const shown = value ?? (cents === null || cents === undefined ? null : money(cents));
    return (
        <View style={[large ? styles.card : styles.row, style]}>
            <View style={large ? null : styles.words}>
                <Text style={styles.label} numberOfLines={large ? undefined : 2}>
                    {label}
                </Text>
                {hint !== undefined && !large ? <Text style={styles.hint}>{hint}</Text> : null}
            </View>
            {shown === null ? (
                <View style={[styles.skeleton, large && styles.skeletonLarge]} />
            ) : (
                <Text style={[large ? styles.valueLarge : styles.value, { color: TONE[tone] }]}>
                    {shown}
                </Text>
            )}
            {hint !== undefined && large ? <Text style={styles.hint}>{hint}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: c.surface,
        borderColor: c.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        padding: 16,
    },
    row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
    words: { flex: 1, minWidth: 0 },
    label: { color: c.muted, fontSize: 14 },
    value: { fontSize: 18, fontWeight: "700", fontVariant: ["tabular-nums"] },
    valueLarge: { fontSize: 26, fontWeight: "700", marginTop: 4, fontVariant: ["tabular-nums"] },
    skeleton: { height: 20, width: 80, borderRadius: 6, backgroundColor: c.surface2 },
    skeletonLarge: { height: 30, width: 130, marginTop: 6 },
    hint: { color: c.muted, fontSize: 12, marginTop: 4 },
});
