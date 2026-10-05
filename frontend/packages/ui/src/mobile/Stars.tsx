import { type StarsProps, strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { Pressable, StyleSheet, Text, View } from "react-native";

const c = theme.colors;
const SIZE = { sm: 14, md: 16, lg: 30 } as const;
const SCALE = [1, 2, 3, 4, 5] as const;

export function Stars({ value, onSelect, size = "md" }: StarsProps) {
    const fontSize = SIZE[size];
    if (onSelect === undefined) {
        return (
            <Text accessibilityLabel={strings.common.ratingOf(value)} style={{ fontSize }}>
                {SCALE.map((n) => (
                    <Text key={n} style={n <= value ? styles.on : styles.off}>
                        ★
                    </Text>
                ))}
            </Text>
        );
    }
    return (
        <View accessibilityRole="radiogroup" style={styles.row}>
            {SCALE.map((n) => (
                <Pressable
                    key={n}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: n === value }}
                    accessibilityLabel={strings.common.stars(n)}
                    hitSlop={6}
                    onPress={() => {
                        onSelect(n);
                    }}
                >
                    <Text style={[{ fontSize }, n <= value ? styles.on : styles.off]}>★</Text>
                </Pressable>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: "row", gap: 6 },
    on: { color: c.accent },
    off: { color: c.border },
});
