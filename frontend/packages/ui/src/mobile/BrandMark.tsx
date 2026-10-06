import { type BrandMarkProps, strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";

const c = theme.colors;
const WORD: Record<string, string> = {
    visa: "VISA",
    mastercard: "MC",
    amex: "AMEX",
    discover: "DISC",
    interac: "INTERAC",
};

export function BrandMark({ method, brand, size = "md" }: BrandMarkProps) {
    const sm = size === "sm";
    return (
        <View accessible={false} style={[styles.box, sm ? styles.sm : styles.md]}>
            {method === "bank_eft" ? (
                <Icon name="bank" size={sm ? 14 : 17} color={c.inkSoft} />
            ) : (
                <Text style={[styles.word, { fontSize: sm ? 9 : 10 }]}>
                    {WORD[method === "interac" ? "interac" : (brand ?? "")] ??
                        strings.ui.cardFallback}
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
    },
    sm: { width: 36, height: 24 },
    md: { width: 48, height: 32 },
    word: { color: c.inkSoft, fontWeight: "800", letterSpacing: 0.5 },
});
