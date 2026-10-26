import { type TabsProps, strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { SHADOW } from "@clientbridge/tokens";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Badge } from "./Badge";
import type { NativeProps } from "./props";

export function Tabs<K extends string>({
    items,
    active,
    onSelect,
    label,
    variant = "underline",
    inset = true,
    style,
}: NativeProps<TabsProps<K>>) {
    const pill = variant === "pill";
    return (
        <ScrollView
            horizontal
            accessibilityRole="tablist"
            accessibilityLabel={label}
            showsHorizontalScrollIndicator={false}
            style={[pill ? styles.pillBar : styles.bar, style]}
            contentContainerStyle={[pill ? styles.pillRow : styles.row, !inset && styles.flush]}
        >
            <View style={pill ? styles.track : styles.plain}>
                {items.map((item) => (
                    <Pressable
                        key={item.key}
                        accessibilityRole="tab"
                        accessibilityLabel={
                            item.count !== undefined && item.count > 0
                                ? strings.common.labelCount(item.label, item.count)
                                : item.label
                        }
                        accessibilityState={{ selected: item.key === active }}
                        style={
                            pill
                                ? [styles.pill, item.key === active && styles.pillOn]
                                : [styles.tab, item.key === active && styles.tabOn]
                        }
                        onPress={() => {
                            onSelect(item.key);
                        }}
                    >
                        <Text
                            style={[
                                styles.label,
                                item.key === active && (pill ? styles.pillLabelOn : styles.labelOn),
                            ]}
                        >
                            {item.label}
                        </Text>
                        {item.count !== undefined && item.count > 0 ? (
                            <Badge
                                label={item.count}
                                variant="count"
                                intent="danger"
                                style={styles.count}
                            />
                        ) : null}
                    </Pressable>
                ))}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    bar: {
        flexGrow: 0,
        flexShrink: 0,
        borderBottomColor: theme.colors.border,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    row: { paddingHorizontal: 20 },
    tab: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingTop: 6,
        paddingBottom: 10,
        borderBottomWidth: 2,
        borderColor: "transparent",
    },
    tabOn: { borderColor: theme.colors.accent },
    label: {
        color: theme.colors.muted,
        fontFamily: theme.fonts.ui,
        fontSize: 14,
        fontWeight: "600",
    },
    labelOn: { color: theme.colors.ink },
    pillBar: { flexGrow: 0, flexShrink: 0 },
    pillRow: { paddingHorizontal: 20, paddingVertical: 4 },
    plain: { flexDirection: "row", gap: 22 },
    track: {
        flexDirection: "row",
        gap: 2,
        padding: 2,
        borderRadius: theme.radius,
        backgroundColor: theme.colors.surface2,
    },
    pill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: theme.radius - 2,
    },
    pillOn: {
        backgroundColor: theme.colors.surface,
        shadowColor: SHADOW,
        shadowOpacity: 0.12,
        shadowRadius: 2,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
    },
    pillLabelOn: { color: theme.colors.ink },
    flush: { paddingHorizontal: 0 },
    count: { alignSelf: "center" },
});
