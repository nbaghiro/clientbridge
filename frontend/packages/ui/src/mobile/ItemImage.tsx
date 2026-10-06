import type { ItemImageProps } from "@clientbridge/app-core";
import { tintHex } from "@clientbridge/tokens";
import { theme } from "@clientbridge/tokens/native";
import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import type { NativeProps } from "./props";

/** An item's picture, or its initial on a tint of its colour when there's none (or it fails). */
export function ItemImage({ src, name, color, size = 40, style }: NativeProps<ItemImageProps>) {
    const [failed, setFailed] = useState(false);
    const box = { width: size, height: size };
    if (src !== null && !failed) {
        return (
            <View style={[box, style]}>
                <Image
                    source={{ uri: src }}
                    style={[styles.box, box]}
                    accessibilityIgnoresInvertColors
                    onError={() => {
                        setFailed(true);
                    }}
                />
            </View>
        );
    }
    const tone = color ?? theme.colors.accent;
    return (
        <View
            style={[
                styles.box,
                styles.fallback,
                box,
                { backgroundColor: tintHex(tone, 12) },
                style,
            ]}
        >
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
