import { type TimeSlotPickerProps, useControllable } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { NativeProps } from "./props";

const c = theme.colors;

export function TimeSlotPicker({
    groups,
    value: valueProp,
    defaultValue = null,
    onChange,
    label,
    columns = 4,
    style,
}: NativeProps<TimeSlotPickerProps>) {
    const [value, setValue] = useControllable<string | null>(valueProp, defaultValue);
    const basis: `${number}%` = `${Math.floor(100 / Math.min(columns, 4)) - 3}%`;
    return (
        <View
            accessibilityRole="radiogroup"
            accessibilityLabel={label}
            style={[styles.wrap, style]}
        >
            {groups.map((g) => (
                <View key={g.label}>
                    <Text style={styles.group}>{g.label}</Text>
                    <View style={styles.grid}>
                        {g.slots.map((slot) => {
                            const on = slot.key === value;
                            return (
                                <Pressable
                                    key={slot.key}
                                    accessibilityRole="radio"
                                    accessibilityState={{
                                        checked: on,
                                        disabled: slot.disabled === true,
                                    }}
                                    disabled={slot.disabled}
                                    onPress={() => {
                                        setValue(slot.key);
                                        onChange?.(slot.key);
                                    }}
                                    style={[
                                        styles.slot,
                                        { flexBasis: basis },
                                        on && styles.on,
                                        slot.disabled === true && styles.taken,
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.label,
                                            on && styles.textOn,
                                            slot.disabled === true && styles.takenText,
                                        ]}
                                    >
                                        {slot.label}
                                    </Text>
                                    {slot.hint !== undefined ? (
                                        <Text style={[styles.hint, on && styles.textOn]}>
                                            {slot.hint}
                                        </Text>
                                    ) : null}
                                </Pressable>
                            );
                        })}
                    </View>
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { gap: 16 },
    group: {
        fontSize: 12,
        fontWeight: "700",
        color: c.muted,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 8,
    },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    slot: {
        alignItems: "center",
        paddingVertical: 10,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
    },
    on: { backgroundColor: c.accent, borderColor: c.accent },
    taken: { backgroundColor: c.bg, borderColor: c.borderSoft },
    label: { fontSize: 15, fontWeight: "600", color: c.ink, fontVariant: ["tabular-nums"] },
    takenText: { color: c.muted, textDecorationLine: "line-through" },
    hint: { fontSize: 11, color: c.muted, marginTop: 1 },
    textOn: { color: c.accentInk },
});
