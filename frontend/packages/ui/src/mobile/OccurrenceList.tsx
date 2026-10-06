import type { OccurrenceListProps } from "@clientbridge/app-core";
import { INTENT_COLORS } from "@clientbridge/tokens";
import { theme } from "@clientbridge/tokens/native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Badge } from "./Badge";
import { Icon } from "./Icon";
import type { NativeProps } from "./props";

const c = theme.colors;

export function OccurrenceList({ rows, label, onAction, style }: NativeProps<OccurrenceListProps>) {
    return (
        <View style={style} accessibilityLabel={label}>
            {rows.map((r, i) => (
                <View
                    key={r.key}
                    style={[styles.row, i > 0 && styles.divider, r.past === true && styles.past]}
                >
                    <Text style={styles.index}>{r.index}</Text>
                    <View
                        style={[styles.dot, { backgroundColor: c[INTENT_COLORS[r.intent].line] }]}
                    />
                    <View style={styles.main}>
                        <View style={styles.line}>
                            <Text
                                style={[
                                    styles.date,
                                    r.intent === "neutral" && r.past !== true && styles.struck,
                                ]}
                            >
                                {r.date}
                            </Text>
                            <Text style={styles.time}>{r.time}</Text>
                            <View style={styles.badge}>
                                <Badge label={r.state} intent={r.intent} />
                            </View>
                        </View>
                        {r.flag ? (
                            <View style={styles.flag}>
                                <Icon name="clock" size={12} color={c.accent} />
                                <Text style={styles.flagText}>{r.flag}</Text>
                            </View>
                        ) : null}
                        {r.note ? (
                            <Text
                                style={[
                                    styles.note,
                                    (r.intent === "danger" || r.intent === "warning") &&
                                        styles.warn,
                                ]}
                            >
                                {r.note}
                            </Text>
                        ) : null}
                        {r.actions && r.actions.length > 0 ? (
                            <View style={styles.actions}>
                                {r.actions.map((a) => (
                                    <Pressable
                                        key={a.key}
                                        accessibilityRole="button"
                                        accessibilityState={{ selected: a.selected === true }}
                                        onPress={() => {
                                            onAction?.(r.key, a.key);
                                        }}
                                        style={[styles.chip, a.selected === true && styles.chipOn]}
                                    >
                                        <Text
                                            style={[
                                                styles.chipText,
                                                a.selected === true && styles.chipTextOn,
                                            ]}
                                        >
                                            {a.label}
                                        </Text>
                                    </Pressable>
                                ))}
                            </View>
                        ) : null}
                    </View>
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: "row", gap: 10, paddingVertical: 11 },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    past: { opacity: 0.6 },
    index: {
        width: 20,
        textAlign: "right",
        fontSize: 12,
        color: c.muted,
        paddingTop: 2,
        fontVariant: ["tabular-nums"],
    },
    dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
    main: { flex: 1, minWidth: 0 },
    line: { flexDirection: "row", alignItems: "center", gap: 8 },
    date: { fontSize: 15, fontWeight: "600", color: c.ink },
    struck: { color: c.muted, textDecorationLine: "line-through" },
    time: { fontSize: 14, color: c.muted },
    badge: { marginLeft: "auto" },
    flag: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
    flagText: { fontSize: 12, color: c.accent },
    note: { fontSize: 12.5, color: c.muted, marginTop: 3 },
    warn: { color: c.warnFg },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
    chip: {
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
    },
    chipOn: { borderColor: c.accent, backgroundColor: c.accentWeak },
    chipText: { fontSize: 13, fontWeight: "600", color: c.inkSoft },
    chipTextOn: { color: c.accentStrong },
});
