import type { ChoiceProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Pressable, StyleSheet, Text, View } from "react-native";

const c = theme.colors;

export function Choice<K extends string>({
    options,
    value,
    onChange,
    layout = "chips",
    label,
}: ChoiceProps<K>) {
    const chosen = (key: K): boolean =>
        Array.isArray(value) ? (value as readonly K[]).includes(key) : value === key;
    const box =
        layout === "cards" ? styles.card : layout === "segmented" ? styles.segment : styles.chip;
    return (
        <View
            accessibilityRole="radiogroup"
            accessibilityLabel={label}
            style={[
                layout === "cards" ? styles.cards : styles.wrap,
                layout === "segmented" && styles.bar,
            ]}
        >
            {options.map((o) => {
                const on = chosen(o.key);
                return (
                    <Pressable
                        key={o.key}
                        disabled={o.disabled}
                        accessibilityRole={Array.isArray(value) ? "checkbox" : "radio"}
                        accessibilityState={{ checked: on, disabled: o.disabled === true }}
                        accessibilityLabel={o.label}
                        onPress={() => {
                            onChange(o.key);
                        }}
                        style={[
                            box,
                            on && (layout === "cards" ? styles.cardOn : styles.on),
                            o.disabled === true && styles.off,
                        ]}
                    >
                        <Text
                            style={[
                                styles.text,
                                layout === "cards" && styles.cardText,
                                on && (layout === "cards" ? styles.cardTextOn : styles.textOn),
                            ]}
                        >
                            {o.label}
                        </Text>
                        {o.hint !== undefined ? (
                            <Text style={[styles.hint, on && layout !== "cards" && styles.textOn]}>
                                {o.hint}
                            </Text>
                        ) : null}
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    bar: {
        flexWrap: "nowrap",
        alignSelf: "flex-start",
        gap: 4,
        padding: 3,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
    },
    cards: { gap: 8 },
    chip: {
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 999,
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.border,
    },
    segment: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: theme.radius - 2 },
    on: { backgroundColor: c.accent, borderColor: c.accent },
    card: {
        padding: 14,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
    },
    cardOn: { borderColor: c.accent, backgroundColor: c.accentWeak },
    off: { opacity: 0.5 },
    text: { color: c.inkSoft, fontSize: 13, fontWeight: "600" },
    textOn: { color: c.accentInk },
    cardText: { color: c.ink, fontSize: 15 },
    cardTextOn: { color: c.accentStrong },
    hint: { color: c.muted, fontSize: 12, marginTop: 2 },
});
