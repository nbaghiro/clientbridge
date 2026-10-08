import { type AvatarProps, initials } from "@clientbridge/app-core";
import { shadeHex, tintHex } from "@clientbridge/tokens";
import { theme } from "@clientbridge/tokens/native";
import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import type { NativeProps } from "./props";

const c = theme.colors;
const SIZE = { sm: 28, md: 36, lg: 44, xl: 64 } as const;

export function Avatar({ name, src, size = "md", color, style }: NativeProps<AvatarProps>) {
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
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
                style,
            ]}
        >
            {src && src !== failedSrc ? (
                <Image
                    source={{ uri: src }}
                    resizeMode="contain"
                    style={{ width: px, height: px }}
                    onError={() => {
                        setFailedSrc(src);
                    }}
                />
            ) : (
                <Text
                    style={[
                        styles.text,
                        {
                            fontSize: Math.round(px * 0.34),
                            color: color ? shadeHex(color, 25) : c.accent,
                        },
                    ]}
                >
                    {/^\p{L}/u.test(name) ? initials(name) : "#"}
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    base: {
        overflow: "hidden",
        borderRadius: theme.avatarRadius,
        alignItems: "center",
        justifyContent: "center",
    },
    text: { fontWeight: "700" },
});
