import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { tintHex } from "@clientbridge/tokens";
import { theme } from "@clientbridge/tokens/native";

export interface ItemImageProps {
    src: string | null;
    name: string;
    color?: string | null | undefined;
    size?: number | undefined;
}

/** An item's picture, or its initial on a tint of its colour when there's none (or it fails). */
export function ItemImage({ src, name, color, size = 40 }: ItemImageProps) {
    const [failed, setFailed] = useState(false);
    const box = { width: size, height: size };
    if (src !== null && !failed) {
        return (
            <Image
                source={{ uri: src }}
                style={[styles.box, box]}
                onError={() => {
                    setFailed(true);
                }}
            />
        );
    }
    const tone = color ?? theme.colors.accent;
    return (
        <View style={[styles.box, styles.fallback, box, { backgroundColor: tintHex(tone, 12) }]}>
            <Text style={[styles.initial, { color: tone, fontSize: size * 0.42 }]}>
                {name.trim().charAt(0).toUpperCase()}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    box: { borderRadius: 8 },
    fallback: { alignItems: "center", justifyContent: "center" },
    initial: { fontWeight: "600" },
});
