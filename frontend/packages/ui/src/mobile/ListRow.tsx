import type { ListRowProps } from "@clientbridge/app-core";
import { INTENT_COLORS } from "@clientbridge/tokens";
import { theme } from "@clientbridge/tokens/native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";
import type { NativeProps, WithRef } from "./props";

const c = theme.colors;

function asText(node: ReactNode, style: object, lines = 1) {
    return typeof node === "string" || typeof node === "number" ? (
        <Text style={style} numberOfLines={lines}>
            {node}
        </Text>
    ) : (
        node
    );
}

export function ListRow({
    title,
    detail,
    meta,
    icon,
    intent = "neutral",
    leading,
    trailing,
    unread,
    selected,
    onPress,
    label,
    density = "regular",
    style,
    ref,
}: NativeProps<ListRowProps> & WithRef<View>) {
    const compact = density === "compact";
    const tone = INTENT_COLORS[intent];
    const tile = compact ? 32 : 38;
    const body = (
        <>
            {unread !== undefined ? <View style={[styles.dot, unread && styles.dotOn]} /> : null}
            {leading ??
                (icon ? (
                    <View
                        style={[
                            styles.tile,
                            { width: tile, height: tile, backgroundColor: c[tone.soft] },
                        ]}
                    >
                        <Icon name={icon} size={compact ? 16 : 19} color={c[tone.ink]} />
                    </View>
                ) : null)}
            <View style={styles.main}>
                {asText(title, [styles.title, unread ? styles.titleUnread : null])}
                {detail !== undefined ? asText(detail, styles.detail, 2) : null}
            </View>
            {meta !== undefined ? (
                <View style={[styles.meta, detail === undefined && styles.metaCenter]}>
                    {asText(meta, styles.metaText)}
                </View>
            ) : null}
        </>
    );
    const pad = compact ? styles.padCompact : styles.pad;
    return (
        <View style={[styles.row, selected === true && styles.active, style]}>
            {onPress ? (
                <Pressable
                    onPress={onPress}
                    ref={ref}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    accessibilityState={{ selected: selected === true }}
                    style={({ pressed }) => [styles.press, pad, pressed && styles.pressed]}
                >
                    {body}
                </Pressable>
            ) : (
                <View style={[styles.press, pad]}>{body}</View>
            )}
            {trailing !== undefined ? <View style={styles.trailing}>{trailing}</View> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center" },
    active: { backgroundColor: c.accentWeak },
    press: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 },
    pad: { paddingVertical: 12, paddingHorizontal: 16 },
    padCompact: { paddingVertical: 9, paddingHorizontal: 14 },
    pressed: { backgroundColor: c.bg },
    dot: { width: 8, height: 8, borderRadius: 4, marginRight: -4 },
    dotOn: { backgroundColor: c.accent },
    tile: { borderRadius: theme.radius, alignItems: "center", justifyContent: "center" },
    main: { flex: 1, minWidth: 0 },
    title: { color: c.ink, fontSize: 15, fontWeight: "500" },
    titleUnread: { fontWeight: "700" },
    detail: { color: c.muted, fontSize: 13, marginTop: 2, lineHeight: 18 },
    meta: { alignItems: "flex-end", alignSelf: "flex-start", paddingTop: 2 },
    metaCenter: { alignSelf: "center", paddingTop: 0 },
    metaText: { color: c.muted, fontSize: 12 },
    trailing: { flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 16 },
});
