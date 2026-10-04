import { theme } from "@clientbridge/tokens/theme";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

export function Segmented<K extends string>({
    items,
    active,
    onSelect,
    pill = false,
}: {
    items: { key: K; label: string }[];
    active: K;
    onSelect: (key: K) => void;
    pill?: boolean;
}) {
    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={pill ? styles.pillBar : styles.bar}
            contentContainerStyle={pill ? styles.pillRow : styles.row}
        >
            {items.map((item) => (
                <Pressable
                    key={item.key}
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
                </Pressable>
            ))}
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
    row: { paddingHorizontal: 20, gap: 22 },
    tab: { paddingTop: 6, paddingBottom: 10, borderBottomWidth: 2, borderColor: "transparent" },
    tabOn: { borderColor: theme.colors.accent },
    label: { color: theme.colors.muted, fontSize: 14, fontWeight: "600" },
    labelOn: { color: theme.colors.ink },
    pillBar: { flexGrow: 0, flexShrink: 0 },
    pillRow: { paddingHorizontal: 20, paddingVertical: 4, gap: 8 },
    pill: {
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface,
    },
    pillOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
    pillLabelOn: { color: theme.colors.accentInk },
});
