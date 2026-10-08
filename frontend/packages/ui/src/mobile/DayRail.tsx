import { type DayRailProps, strings, useControllable } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { ScrollView, StyleSheet, Pressable, Text, View } from "react-native";

import { IconButton } from "./IconButton";
import type { NativeProps } from "./props";

const c = theme.colors;

export function DayRail({
    days,
    value: valueProp,
    defaultValue = null,
    onChange,
    label,
    onPrev,
    onNext,
    prevLabel = strings.ui.previous,
    nextLabel = strings.ui.next,
    style,
}: NativeProps<DayRailProps>) {
    const [value, setValue] = useControllable<string | null>(valueProp, defaultValue);
    return (
        <View style={[styles.wrap, style]}>
            {onPrev !== undefined ? (
                <IconButton icon="chevronLeft" label={prevLabel} onPress={onPrev} />
            ) : null}
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                accessibilityRole="radiogroup"
                accessibilityLabel={label}
                contentContainerStyle={styles.rail}
                style={styles.scroll}
            >
                {days.map((day) => {
                    const on = day.key === value;
                    return (
                        <Pressable
                            key={day.key}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: on, disabled: day.disabled === true }}
                            disabled={day.disabled}
                            onPress={() => {
                                setValue(day.key);
                                onChange?.(day.key);
                            }}
                            style={[
                                styles.day,
                                on && styles.on,
                                day.disabled === true && styles.disabled,
                            ]}
                        >
                            <Text style={[styles.weekday, on && styles.onText]}>{day.weekday}</Text>
                            <Text style={[styles.number, on && styles.onText]}>{day.day}</Text>
                            {day.hint !== undefined ? (
                                <Text style={[styles.hint, on && styles.onText]}>{day.hint}</Text>
                            ) : null}
                        </Pressable>
                    );
                })}
            </ScrollView>
            {onNext !== undefined ? (
                <IconButton icon="chevronRight" label={nextLabel} onPress={onNext} />
            ) : null}
        </View>
    );
}
const styles = StyleSheet.create({
    wrap: { flexDirection: "row", alignItems: "center", gap: 4 },
    scroll: { flex: 1, minWidth: 0 },
    rail: { gap: 8, paddingBottom: 4 },
    day: {
        minWidth: 64,
        height: 68,
        paddingHorizontal: 8,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        alignItems: "center",
        justifyContent: "center",
    },
    on: { backgroundColor: c.accent, borderColor: c.accent },
    disabled: { opacity: 0.5 },
    weekday: { color: c.muted, fontSize: 11, fontWeight: "600", textTransform: "uppercase" },
    number: { color: c.ink, fontSize: 18, fontWeight: "700", fontVariant: ["tabular-nums"] },
    hint: { color: c.accent, fontSize: 11 },
    onText: { color: c.accentInk },
});
