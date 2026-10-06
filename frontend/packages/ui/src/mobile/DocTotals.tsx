import { type DocTotalsProps, formatMoney } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";

const c = theme.colors;

export function DocTotals({ lines, density = "regular" }: DocTotalsProps) {
    return (
        <View>
            {lines.map((line) => {
                const ruled = line.kind === "total" || line.kind === "balance";
                const amount =
                    (line.kind === "credit" || line.kind === "deduction") && line.cents !== 0
                        ? `−${formatMoney(line.cents)}`
                        : formatMoney(line.cents);
                return (
                    <View
                        key={line.key}
                        style={[
                            styles.row,
                            density === "compact" && styles.compact,
                            ruled && styles.ruled,
                        ]}
                    >
                        <Text style={[styles.label, ruled && styles.labelStrong]}>
                            {line.label}
                            {line.hint !== undefined ? (
                                <Text style={styles.hint}>{`  ${line.hint}`}</Text>
                            ) : null}
                        </Text>
                        <Text
                            style={[
                                styles.amount,
                                line.kind === "total" && styles.total,
                                line.kind === "credit" && styles.credit,
                                line.kind === "balance" && styles.balance,
                            ]}
                        >
                            {amount}
                        </Text>
                    </View>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 12,
        paddingVertical: 5,
    },
    compact: { paddingVertical: 3 },
    ruled: { marginTop: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.border },
    label: { color: c.muted, fontSize: 14, flexShrink: 1 },
    labelStrong: { color: c.ink, fontWeight: "600" },
    hint: { color: c.muted, fontSize: 12, fontWeight: "400" },
    amount: { color: c.inkSoft, fontSize: 14, fontWeight: "500", fontVariant: ["tabular-nums"] },
    total: { color: c.ink, fontWeight: "700" },
    credit: { color: c.okFg },
    balance: { color: c.ink, fontSize: 20, fontWeight: "700" },
});
