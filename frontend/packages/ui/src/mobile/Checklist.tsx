import type { ChecklistProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";

const c = theme.colors;

export function Checklist({ items, label }: ChecklistProps) {
    return (
        <View accessibilityLabel={label}>
            {items.map((item, i) => {
                const body = (
                    <>
                        <View
                            style={[
                                styles.mark,
                                item.done
                                    ? styles.done
                                    : item.attention
                                      ? styles.attention
                                      : styles.todo,
                            ]}
                        >
                            {item.done ? (
                                <Icon name="check" size={14} color={c.okFg} />
                            ) : item.attention ? (
                                <Icon name="alert" size={13} color={c.warnFg} />
                            ) : null}
                        </View>
                        <View style={styles.text}>
                            <Text style={[styles.label, item.done && styles.labelDone]}>
                                {item.label}
                            </Text>
                            {item.hint !== undefined ? (
                                <Text style={[styles.hint, item.attention && styles.hintWarn]}>
                                    {item.hint}
                                </Text>
                            ) : null}
                        </View>
                        {item.action !== undefined ? (
                            <View style={styles.action}>
                                <Text style={[styles.actionText, item.done && styles.actionQuiet]}>
                                    {item.action.label}
                                </Text>
                                <Icon
                                    name="chevron"
                                    size={16}
                                    color={item.done ? c.muted : c.accent}
                                />
                            </View>
                        ) : null}
                    </>
                );
                return item.action !== undefined ? (
                    <Pressable
                        key={item.key}
                        onPress={item.action.onPress}
                        accessibilityRole="button"
                        accessibilityLabel={`${item.label}. ${item.action.label}`}
                        accessibilityState={{ checked: item.done }}
                        style={[styles.row, i > 0 && styles.divider]}
                    >
                        {body}
                    </Pressable>
                ) : (
                    <View
                        key={item.key}
                        style={[styles.row, i > 0 && styles.divider]}
                        accessibilityState={{ checked: item.done }}
                    >
                        {body}
                    </View>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13 },
    divider: { borderTopColor: c.borderSoft, borderTopWidth: StyleSheet.hairlineWidth },
    mark: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
    },
    done: { backgroundColor: c.okBg },
    attention: { backgroundColor: c.warnBg },
    todo: { borderWidth: 2, borderStyle: "dashed", borderColor: c.border },
    text: { flex: 1, minWidth: 0 },
    label: { color: c.ink, fontSize: 15, fontWeight: "600" },
    labelDone: { color: c.muted, fontWeight: "500" },
    hint: { color: c.muted, fontSize: 13, marginTop: 2, lineHeight: 18 },
    hintWarn: { color: c.warnFg },
    action: { flexDirection: "row", alignItems: "center", gap: 2 },
    actionText: { color: c.accent, fontSize: 14, fontWeight: "600" },
    actionQuiet: { color: c.muted, fontWeight: "500" },
});
