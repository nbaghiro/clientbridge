import { type SwatchPickerProps, useControllable } from "@clientbridge/app-core";
import { ON_DATA } from "@clientbridge/tokens";
import { theme } from "@clientbridge/tokens/native";
import { Pressable, StyleSheet, View } from "react-native";

import { Icon } from "./Icon";
import type { NativeProps } from "./props";

export function SwatchPicker({
    label,
    colours,
    value: valueProp,
    defaultValue = "",
    onChange,
    style,
}: NativeProps<SwatchPickerProps>) {
    const [value, setValue] = useControllable(valueProp, defaultValue, onChange);
    return (
        <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.row, style]}>
            {colours.map((colour) => {
                const on = colour.toLowerCase() === value.toLowerCase();
                return (
                    <Pressable
                        key={colour}
                        accessibilityRole="radio"
                        accessibilityLabel={colour}
                        accessibilityState={{ checked: on }}
                        onPress={() => {
                            setValue(colour);
                        }}
                        style={[styles.ring, on && styles.ringOn]}
                    >
                        <View style={[styles.swatch, { backgroundColor: colour }]}>
                            {on ? <Icon name="check" size={16} color={ON_DATA} /> : null}
                        </View>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
    ring: { padding: 2, borderRadius: 20, borderWidth: 2, borderColor: "transparent" },
    ringOn: { borderColor: theme.colors.ink },
    swatch: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
    },
});
