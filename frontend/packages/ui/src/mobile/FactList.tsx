import type { FactListProps } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { StyleSheet, Text, View } from "react-native";

import { Icon } from "./Icon";
import type { NativeProps } from "./props";

const c = theme.colors;

export function FactList({ facts, label, style }: NativeProps<FactListProps>) {
    return (
        <View accessibilityLabel={label} style={[styles.list, style]}>
            {facts.map((f) => (
                <View key={f.key} style={styles.row}>
                    <View style={styles.tile}>
                        <Icon name={f.icon} size={16} color={c.inkSoft} />
                    </View>
                    <View style={styles.text}>
                        <Text style={styles.title}>{f.title}</Text>
                        {f.detail !== undefined ? (
                            <Text style={styles.detail}>{f.detail}</Text>
                        ) : null}
                    </View>
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    list: { gap: 12 },
    row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
    tile: {
        width: 32,
        height: 32,
        borderRadius: 8,
        backgroundColor: c.bg,
        alignItems: "center",
        justifyContent: "center",
    },
    text: { flex: 1, minWidth: 0 },
    title: { color: c.ink, fontSize: 14, fontWeight: "600" },
    detail: { color: c.muted, fontSize: 12, marginTop: 1 },
});
