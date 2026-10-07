import { type ItemTileProps, formatMoney, strings } from "@clientbridge/app-core";
import { tintHex } from "@clientbridge/tokens";
import { theme } from "@clientbridge/tokens/native";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { Badge } from "./Badge";
import { ItemImage } from "./ItemImage";
import type { NativeProps } from "./props";

const c = theme.colors;

export function ItemTile({
    name,
    imageSrc,
    color,
    cents,
    meta,
    tag,
    count = 0,
    onPress,
    disabled = false,
    variant = "tile",
    style,
}: NativeProps<ItemTileProps>) {
    const tone = color ?? c.accent;
    const a11y = count > 0 ? strings.ui.onTicket(name, count) : name;
    if (variant === "card") {
        return (
            <Pressable
                onPress={onPress}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={a11y}
                style={[styles.card, disabled && styles.dim, style]}
            >
                <View style={styles.photo}>
                    {imageSrc !== null ? (
                        <Image
                            source={{ uri: imageSrc }}
                            style={styles.photoImg}
                            resizeMode="cover"
                        />
                    ) : (
                        <View
                            style={[
                                styles.photoImg,
                                styles.initial,
                                { backgroundColor: tintHex(tone, 12) },
                            ]}
                        >
                            <Text style={[styles.initialText, { color: tone }]}>
                                {name.trim().charAt(0).toUpperCase()}
                            </Text>
                        </View>
                    )}
                    {tag ? (
                        <View style={styles.photoTag}>
                            <Badge label={tag.label} intent={tag.intent} />
                        </View>
                    ) : null}
                    {count > 0 ? (
                        <View style={[styles.count, styles.photoCount]}>
                            <Text style={styles.countText}>{count}</Text>
                        </View>
                    ) : null}
                </View>
                <View style={styles.cardBody}>
                    <Text style={styles.name} numberOfLines={2}>
                        {name}
                    </Text>
                    <View style={styles.foot}>
                        <Text style={styles.meta} numberOfLines={1}>
                            {meta}
                        </Text>
                        {cents === null ? null : (
                            <Text style={styles.price}>{formatMoney(cents)}</Text>
                        )}
                    </View>
                </View>
            </Pressable>
        );
    }
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={a11y}
            style={({ pressed }) => [
                styles.tile,
                count > 0 && styles.tileOn,
                (pressed || disabled) && styles.dim,
                style,
            ]}
        >
            <View style={styles.top}>
                <ItemImage src={imageSrc} name={name} color={color} size={34} />
                {count > 0 ? (
                    <View style={styles.count}>
                        <Text style={styles.countText}>{count}</Text>
                    </View>
                ) : tag ? (
                    <Badge label={tag.label} intent={tag.intent} />
                ) : null}
            </View>
            <Text style={styles.name} numberOfLines={2}>
                {name}
            </Text>
            <View style={styles.foot}>
                <Text style={styles.meta} numberOfLines={1}>
                    {meta}
                </Text>
                {cents === null ? null : <Text style={styles.price}>{formatMoney(cents)}</Text>}
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    tile: {
        flex: 1,
        minHeight: 112,
        padding: 12,
        borderRadius: theme.radius + 2,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
    },
    tileOn: { borderColor: c.accent, borderWidth: 2, padding: 11 },
    dim: { opacity: 0.55 },
    top: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
    count: {
        minWidth: 22,
        height: 22,
        borderRadius: 11,
        paddingHorizontal: 6,
        backgroundColor: c.accent,
        alignItems: "center",
        justifyContent: "center",
    },
    countText: { color: c.accentInk, fontSize: 12, fontWeight: "700" },
    name: { color: c.ink, fontSize: 14, fontWeight: "600", marginTop: 8, lineHeight: 18 },
    foot: {
        flexDirection: "row",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 6,
        marginTop: "auto",
        paddingTop: 6,
    },
    meta: { color: c.muted, fontSize: 12, flexShrink: 1 },
    price: { color: c.ink, fontSize: 14, fontWeight: "700", fontVariant: ["tabular-nums"] },
    card: {
        flex: 1,
        borderRadius: theme.radius + 2,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        overflow: "hidden",
    },
    photo: { aspectRatio: 4 / 3, backgroundColor: c.bg },
    photoImg: { width: "100%", height: "100%" },
    initial: { alignItems: "center", justifyContent: "center" },
    initialText: { fontSize: 30, fontWeight: "700" },
    photoTag: { position: "absolute", left: 8, top: 8 },
    photoCount: { position: "absolute", right: 8, top: 8 },
    cardBody: { padding: 10, paddingTop: 8, flex: 1 },
});
