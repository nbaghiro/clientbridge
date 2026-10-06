import type { CheckboxProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";

const c = theme.colors;

export function Checkbox({
    label,
    value,
    onChange,
    hideLabel = false,
    mixed = false,
    disabled = false,
}: CheckboxProps) {
    return (
        <Pressable
            onPress={() => {
                onChange(!value);
            }}
            disabled={disabled}
            hitSlop={8}
            accessibilityRole="checkbox"
            accessibilityLabel={label}
            accessibilityState={{ checked: mixed && !value ? "mixed" : value, disabled }}
            style={[styles.row, disabled && styles.off]}
        >
            <View style={[styles.box, (value || mixed) && styles.on]}>
                {value ? (
                    <Icon name="check" size={14} color={c.accentInk} />
                ) : mixed ? (
                    <View style={styles.dash} />
                ) : null}
            </View>
            {hideLabel ? null : <Text style={styles.label}>{label}</Text>}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 10 },
    off: { opacity: 0.6 },
    box: {
        width: 22,
        height: 22,
        borderRadius: 6,
        borderWidth: 1.5,
        borderColor: c.border,
        backgroundColor: c.surface,
        alignItems: "center",
        justifyContent: "center",
    },
    on: { backgroundColor: c.accent, borderColor: c.accent },
    dash: { width: 10, height: 2, borderRadius: 1, backgroundColor: c.accentInk },
    label: { color: c.ink, fontSize: 15 },
});
