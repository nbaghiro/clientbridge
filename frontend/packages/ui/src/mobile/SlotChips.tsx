import { type SlotChipsProps, type TimeSlot, useControllable } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { NativeProps } from "./props";

const c = theme.colors;
export function SlotChips({
    groups,
    value: valueProp,
    defaultValue = null,
    onChange,
    label,
    layout = "grid",
    columns = 3,
    size = "lg",
    style,
}: NativeProps<SlotChipsProps>) {
    const [value, setValue] = useControllable<string | null>(valueProp, defaultValue);
    const chip = (slot: TimeSlot) => {
        const on = slot.key === value;
        return (
            <Pressable
                key={slot.key}
                accessibilityRole="radio"
                accessibilityState={{ checked: on, disabled: slot.disabled === true }}
                disabled={slot.disabled}
                onPress={() => {
                    setValue(slot.key);
                    onChange?.(slot.key);
                }}
                style={[
                    styles.chip,
                    size === "lg" ? styles.large : styles.medium,
                    layout === "rail" ? styles.railChip : styles.cell,
                    on && styles.on,
                    slot.disabled === true && styles.disabled,
                ]}
            >
                <Text
                    style={[
                        styles.label,
                        size === "lg" && styles.largeText,
                        on && styles.onText,
                        slot.disabled === true && styles.taken,
                    ]}
                >
                    {slot.label}
                </Text>
                {slot.hint !== undefined ? (
                    <Text numberOfLines={1} style={[styles.hint, on && styles.onText]}>
                        {slot.hint}
                    </Text>
                ) : null}
            </Pressable>
        );
    };
    return (
        <View
            accessibilityRole="radiogroup"
            accessibilityLabel={label}
            style={[styles.wrap, style]}
        >
            {groups.map((group) => (
                <View key={group.label || group.slots[0]?.key}>
                    {group.label !== "" ? <Text style={styles.group}>{group.label}</Text> : null}
                    {layout === "rail" ? (
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.row}
                        >
                            {group.slots.map(chip)}
                        </ScrollView>
                    ) : layout === "stack" ? (
                        <View style={styles.grid}>{group.slots.map(chip)}</View>
                    ) : (
                        <View style={styles.grid}>
                            {Array.from(
                                { length: Math.ceil(group.slots.length / columns) },
                                (_, row) => (
                                    <View key={row} style={styles.row}>
                                        {Array.from({ length: columns }, (_, col) => {
                                            const slot = group.slots[row * columns + col];
                                            return slot === undefined ? (
                                                <View key={col} style={styles.cell} />
                                            ) : (
                                                chip(slot)
                                            );
                                        })}
                                    </View>
                                ),
                            )}
                        </View>
                    )}
                </View>
            ))}
        </View>
    );
}
const styles = StyleSheet.create({
    wrap: { gap: 16 },
    group: {
        color: c.muted,
        fontSize: 12,
        fontWeight: "600",
        textTransform: "uppercase",
        marginBottom: 8,
    },
    row: { flexDirection: "row", gap: 8 },
    grid: { gap: 8 },
    cell: { flex: 1, minWidth: 0 },
    railChip: { minWidth: 92 },
    chip: {
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 10,
    },
    large: { minHeight: 48 },
    medium: { minHeight: 40 },
    label: { color: c.ink, fontSize: 14, fontWeight: "600" },
    largeText: { fontSize: 15 },
    hint: { color: c.muted, fontSize: 11 },
    on: { borderColor: c.accent, backgroundColor: c.accent },
    onText: { color: c.accentInk },
    disabled: { opacity: 0.5 },
    taken: { textDecorationLine: "line-through" },
});
