import { type DateStripProps, strings, useControllable } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";
import type { NativeProps } from "./props";

const c = theme.colors;

export function DateStrip({
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
}: NativeProps<DateStripProps>) {
    const [value, setValue] = useControllable<string | null>(valueProp, defaultValue);
    return (
        <View style={[styles.wrap, style]} accessibilityLabel={label}>
            {onPrev !== undefined ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={prevLabel}
                    onPress={onPrev}
                    style={styles.arrow}
                    hitSlop={6}
                >
                    <Icon name="chevronLeft" size={18} color={c.muted} />
                </Pressable>
            ) : null}
            {days.map((d) => {
                const on = d.key === value;
                const off = d.disabled === true || d.closed === true;
                return (
                    <Pressable
                        key={d.key}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on, disabled: off }}
                        accessibilityLabel={`${d.weekday} ${d.day}`}
                        disabled={off}
                        onPress={() => {
                            setValue(d.key);
                            onChange?.(d.key);
                        }}
                        style={[styles.day, on && styles.dayOn]}
                    >
                        <Text
                            numberOfLines={1}
                            style={[
                                styles.dow,
                                d.isToday === true && styles.today,
                                on && styles.textOn,
                            ]}
                        >
                            {d.weekday}
                        </Text>
                        <Text style={[styles.num, off && styles.off, on && styles.textOn]}>
                            {d.day}
                        </Text>
                        <View style={styles.dots}>
                            {d.closed === true
                                ? null
                                : Array.from({ length: d.busy ?? 0 }, (_, i) => (
                                      <View key={i} style={[styles.dot, on && styles.dotOn]} />
                                  ))}
                        </View>
                    </Pressable>
                );
            })}
            {onNext !== undefined ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={nextLabel}
                    onPress={onNext}
                    style={styles.arrow}
                    hitSlop={6}
                >
                    <Icon name="chevronRight" size={18} color={c.muted} />
                </Pressable>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { flexDirection: "row", alignItems: "stretch", gap: 2 },
    arrow: { width: 24, alignItems: "center", justifyContent: "center" },
    day: { flex: 1, alignItems: "center", paddingVertical: 6, borderRadius: 10 },
    dayOn: { backgroundColor: c.accent },
    dow: { fontSize: 11, fontWeight: "600", color: c.muted, textTransform: "uppercase" },
    today: { color: c.accent },
    num: {
        fontSize: 17,
        fontWeight: "700",
        color: c.ink,
        marginTop: 2,
        fontVariant: ["tabular-nums"],
    },
    off: { color: c.muted, textDecorationLine: "line-through", opacity: 0.6 },
    textOn: { color: c.accentInk },
    dots: { flexDirection: "row", gap: 2, height: 5, marginTop: 3 },
    dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: c.accent },
    dotOn: { backgroundColor: c.accentInk },
});
