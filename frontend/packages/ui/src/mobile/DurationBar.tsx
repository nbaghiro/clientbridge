import type { DurationBarProps } from "@clientbridge/app-core";
import { tintHex } from "@clientbridge/tokens";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";

import type { NativeProps } from "./props";

const c = theme.colors;

export function DurationBar({ segments, color, caption, style }: NativeProps<DurationBarProps>) {
    const tone = color ?? c.accent;
    const shown = segments.filter((seg) => seg.minutes > 0);
    return (
        <View style={style}>
            <View
                style={styles.bar}
                accessible
                accessibilityRole="image"
                accessibilityLabel={caption ?? shown.map((seg) => seg.label).join(", ")}
            >
                {shown.map((seg) => (
                    <View
                        key={seg.key}
                        style={[
                            styles.seg,
                            { flexGrow: seg.minutes },
                            seg.kind === "main"
                                ? {
                                      backgroundColor: tintHex(tone, 15),
                                      borderLeftWidth: 3,
                                      borderLeftColor: tone,
                                  }
                                : styles.buffer,
                        ]}
                    >
                        <Text
                            style={[
                                styles.label,
                                seg.kind === "main" ? { color: tone } : styles.bufferText,
                            ]}
                            numberOfLines={1}
                        >
                            {seg.label}
                        </Text>
                    </View>
                ))}
            </View>
            {caption !== undefined ? <Text style={styles.caption}>{caption}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    bar: {
        flexDirection: "row",
        height: 40,
        gap: 2,
        borderRadius: theme.radius,
        overflow: "hidden",
    },
    seg: { minWidth: 62, justifyContent: "center", paddingHorizontal: 8, flexBasis: 0 },
    buffer: {
        backgroundColor: c.surface2,
        borderStyle: "dashed",
        borderWidth: 1,
        borderColor: c.border,
    },
    label: { fontSize: 12, fontWeight: "700" },
    bufferText: { color: c.muted, fontWeight: "600" },
    caption: { color: c.muted, fontSize: 12.5, marginTop: 8, lineHeight: 17 },
});
