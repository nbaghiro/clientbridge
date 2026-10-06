import type { ImagePickerProps } from "@clientbridge/app-core";
import { tintHex } from "@clientbridge/tokens";
import { theme } from "@clientbridge/tokens/native";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "./Button";
import { Icon } from "./Icon";
import type { NativeProps } from "./props";

const c = theme.colors;

export function ImagePicker({
    src,
    name,
    color,
    label,
    hint,
    onPick,
    onPickAlt,
    altLabel,
    onRemove,
    removeLabel,
    busy = false,
    size = "md",
    style,
}: NativeProps<ImagePickerProps>) {
    const px = size === "lg" ? 120 : 80;
    const tone = color ?? c.accent;
    return (
        <View style={[styles.row, style]}>
            <Pressable
                onPress={onPick}
                accessibilityRole="button"
                accessibilityLabel={`${label}, ${name}`}
                style={[styles.box, { width: px, height: px }, src === null && styles.empty]}
            >
                {src !== null ? (
                    <Image
                        source={{ uri: src }}
                        style={{ width: px, height: px }}
                        resizeMode="cover"
                    />
                ) : busy ? (
                    <ActivityIndicator color={tone} />
                ) : (
                    <View style={[styles.glyph, { backgroundColor: tintHex(tone, 12) }]}>
                        <Icon name="image" size={22} color={tone} />
                    </View>
                )}
            </Pressable>
            <View style={styles.side}>
                {hint !== undefined ? <Text style={styles.hint}>{hint}</Text> : null}
                <View style={styles.actions}>
                    <Button size="sm" variant="outline" onPress={onPick} disabled={busy}>
                        {label}
                    </Button>
                    {onPickAlt !== undefined && altLabel !== undefined ? (
                        <Button size="sm" variant="outline" onPress={onPickAlt} disabled={busy}>
                            {altLabel}
                        </Button>
                    ) : null}
                </View>
                {src !== null && onRemove !== undefined ? (
                    <Button size="sm" variant="link" onPress={onRemove}>
                        {removeLabel ?? ""}
                    </Button>
                ) : null}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 14 },
    box: {
        borderRadius: theme.radius + 2,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: c.border,
    },
    empty: { borderStyle: "dashed", backgroundColor: c.bg },
    glyph: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
    },
    side: { flex: 1, gap: 8 },
    hint: { color: c.muted, fontSize: 12.5, lineHeight: 17 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
