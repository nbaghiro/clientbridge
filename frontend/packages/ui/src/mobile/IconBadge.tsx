import type { IconBadgeProps } from "@clientbridge/app-core";
import { INTENT_COLORS } from "@clientbridge/tokens";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, View } from "react-native";

import { Icon } from "./Icon";
import type { NativeProps } from "./props";

const c = theme.colors;

export function IconBadge({
    icon,
    intent = "neutral",
    size = "md",
    style,
}: NativeProps<IconBadgeProps>) {
    const tone = INTENT_COLORS[intent];
    const px = size === "sm" ? 32 : 40;
    return (
        <View
            style={[
                styles.badge,
                { width: px, height: px, borderRadius: px / 2, backgroundColor: c[tone.soft] },
                style,
            ]}
        >
            <Icon name={icon} size={size === "sm" ? 16 : 19} color={c[tone.ink]} />
        </View>
    );
}

const styles = StyleSheet.create({
    badge: { alignItems: "center", justifyContent: "center" },
});
