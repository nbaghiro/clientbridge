import { type BrandMarkProps, strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";
import type { NativeProps } from "./props";

const c = theme.colors;
const WORD: Record<string, string> = {
    visa: "VISA",
    mastercard: "MC",
    amex: "AMEX",
    discover: "DISC",
    interac: "INTERAC",
};

export function BrandMark({ method, brand, size = "md", style }: NativeProps<BrandMarkProps>) {
    const sm = size === "sm";
    const word = WORD[method === "interac" ? "interac" : (brand ?? "")] ?? strings.ui.cardFallback;
    const long = word.length > 4;
    return (
        <View accessible={false} style={[styles.box, sm ? styles.sm : styles.md, style]}>
            {method === "bank_eft" ? (
                <Icon name="bank" size={sm ? 14 : 17} color={c.inkSoft} />
            ) : (
                <Text
                    numberOfLines={1}
                    style={[
                        styles.word,
                        { fontSize: (sm ? 9 : 10) - (long ? 2 : 0) },
                        long ? styles.tight : null,
                    ]}
                >
                    {word}
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    box: {
        alignItems: "center",
        justifyContent: "center",
        borderRadius: theme.radius - 2,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface2,
        overflow: "hidden",
    },
    sm: { width: 36, height: 24 },
    md: { width: 48, height: 32 },
    word: { color: c.inkSoft, fontWeight: "800", letterSpacing: 0.5 },
    tight: { letterSpacing: 0 },
});
