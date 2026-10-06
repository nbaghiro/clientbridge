import { type LineItemProps, formatMoney } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Badge } from "./Badge";
import { Stepper } from "./Stepper";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";

const c = theme.colors;

export function LineItem({
    title,
    meta,
    leading,
    quantity,
    count,
    cents,
    originalCents,
    tag,
    onPress,
    pressLabel,
    onRemove,
    removeLabel,
    selected = false,
}: LineItemProps) {
    const body = (
        <>
            <Text style={styles.title} numberOfLines={2}>
                {title}
            </Text>
            {tag ? (
                <View style={styles.titleRow}>
                    <Badge label={tag.label} intent={tag.intent} />
                </View>
            ) : null}
            {meta !== undefined && meta !== "" ? (
                <Text style={styles.meta} numberOfLines={1}>
                    {meta}
                </Text>
            ) : null}
        </>
    );
    return (
        <View style={[styles.row, selected && styles.selected]}>
            {leading}
            <View style={styles.main}>
                {onPress !== undefined ? (
                    <Pressable
                        onPress={onPress}
                        accessibilityRole="button"
                        accessibilityLabel={pressLabel}
                    >
                        {body}
                    </Pressable>
                ) : (
                    body
                )}
                {quantity !== undefined ? (
                    <View style={styles.stepper}>
                        <Stepper
                            value={quantity.value}
                            onChange={quantity.onChange}
                            min={0}
                            label={quantity.label}
                        />
                    </View>
                ) : null}
            </View>
            {count !== undefined && count > 1 ? <Text style={styles.count}>{count} ×</Text> : null}
            <View style={styles.amount}>
                {originalCents !== undefined &&
                originalCents !== null &&
                originalCents !== cents ? (
                    <Text style={styles.was}>{formatMoney(originalCents)}</Text>
                ) : null}
                <Text style={styles.cents}>{formatMoney(cents)}</Text>
            </View>
            {onRemove !== undefined ? (
                <Pressable
                    onPress={onRemove}
                    accessibilityRole="button"
                    accessibilityLabel={removeLabel}
                    hitSlop={8}
                    style={styles.remove}
                >
                    <Icon name="x" size={16} color={c.muted} />
                </Pressable>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
    selected: {
        backgroundColor: c.accentWeak,
        borderRadius: theme.radius,
        marginHorizontal: -8,
        paddingHorizontal: 8,
    },
    main: { flex: 1, minWidth: 0 },
    titleRow: { flexDirection: "row", marginTop: 3 },
    title: { color: c.ink, fontSize: 15, fontWeight: "600", flexShrink: 1 },
    meta: { color: c.muted, fontSize: 12.5, marginTop: 2 },
    stepper: { marginTop: 6, alignSelf: "flex-start" },
    count: { color: c.muted, fontSize: 14, fontVariant: ["tabular-nums"] },
    amount: { minWidth: 64, alignItems: "flex-end" },
    was: {
        color: c.muted,
        fontSize: 12,
        textDecorationLine: "line-through",
        fontVariant: ["tabular-nums"],
    },
    cents: { color: c.ink, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
    remove: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
});
