import { type AvatarProps, initials } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";
import { tintHex } from "@clientbridge/tokens";

const c = theme.colors;
const SIZE = { sm: 28, md: 36, lg: 44, xl: 64 } as const;

export function Avatar({ name, size = "md", color }: AvatarProps) {
    const px = SIZE[size];
    return (
        <View
            accessible={false}
            style={[
                styles.base,
                {
                    width: px,
                    height: px,
                    backgroundColor: color ? tintHex(color, 12) : c.accentWeak,
                },
            ]}
        >
            <Text
                style={[styles.text, { fontSize: Math.round(px * 0.34), color: color ?? c.accent }]}
            >
                {/^\p{L}/u.test(name) ? initials(name) : "#"}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    base: { borderRadius: theme.avatarRadius, alignItems: "center", justifyContent: "center" },
    text: { fontWeight: "700" },
});
