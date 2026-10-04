import { theme } from "@clientbridge/tokens/theme";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

export function Segmented<K extends string>({
    items,
    active,
    onSelect,
}: {
    items: { key: K; label: string }[];
    active: K;
    onSelect: (key: K) => void;
}) {
    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.bar}
            contentContainerStyle={styles.row}
        >
            {items.map((item) => (
                <Pressable
                    key={item.key}
                    style={[styles.tab, item.key === active && styles.tabOn]}
                    onPress={() => {
                        onSelect(item.key);
                    }}
                >
                    <Text style={[styles.label, item.key === active && styles.labelOn]}>
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
        borderBottomColor: theme.colors.border,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    row: { paddingHorizontal: 20, gap: 22 },
    tab: { paddingTop: 6, paddingBottom: 10, borderBottomWidth: 2, borderColor: "transparent" },
    tabOn: { borderColor: theme.colors.accent },
    label: { color: theme.colors.muted, fontSize: 14, fontWeight: "600" },
    labelOn: { color: theme.colors.ink },
});
