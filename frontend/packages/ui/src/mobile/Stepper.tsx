import { type StepperProps, strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { Pressable, StyleSheet, Text, View } from "react-native";

const c = theme.colors;

export function Stepper({ value, onChange, min, max, label }: StepperProps) {
    const atMin = min !== undefined && value <= min;
    const atMax = max !== undefined && value >= max;
    return (
        <View style={styles.row}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={strings.common.decrease(label)}
                disabled={atMin}
                hitSlop={6}
                onPress={() => {
                    onChange(value - 1);
                }}
                style={[styles.step, atMin && styles.off]}
            >
                <Text style={styles.stepText}>−</Text>
            </Pressable>
            <Text style={styles.value}>{value}</Text>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={strings.common.increase(label)}
                disabled={atMax}
                hitSlop={6}
                onPress={() => {
                    onChange(value + 1);
                }}
                style={[styles.step, atMax && styles.off]}
            >
                <Text style={styles.stepText}>+</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 8 },
    step: {
        width: 30,
        height: 30,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        alignItems: "center",
        justifyContent: "center",
    },
    off: { opacity: 0.4 },
    stepText: { color: c.inkSoft, fontSize: 17 },
    value: {
        color: c.ink,
        fontSize: 15,
        minWidth: 22,
        textAlign: "center",
        fontVariant: ["tabular-nums"],
    },
});
