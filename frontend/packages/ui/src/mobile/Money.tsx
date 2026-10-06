import { type MoneyProps, formatMoney } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text } from "react-native";

import type { NativeProps } from "./props";

const c = theme.colors;
const TONES: Record<NonNullable<MoneyProps["tone"]>, string> = {
    ink: c.ink,
    muted: c.muted,
    success: c.success,
    danger: c.danFg,
};

export function Money({ cents, tone = "ink", strong = false, style }: NativeProps<MoneyProps>) {
    return (
        <Text style={[styles.money, { color: TONES[tone] }, strong && styles.strong, style]}>
            {formatMoney(cents)}
        </Text>
    );
}

const styles = StyleSheet.create({
    money: { fontSize: 14, fontWeight: "500", fontVariant: ["tabular-nums"] },
    strong: { fontWeight: "700" },
});
