import { SETTINGS_SECTIONS, type SettingsSectionKey } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { IconChevron } from "../components/icons";
import type { RootStackParamList } from "../navigation";

type Nav = NativeStackNavigationProp<RootStackParamList>;

// Map each shared section key to this platform's stack screen (the routing seam).
const SECTION_SCREEN: Record<SettingsSectionKey, keyof RootStackParamList> = {
    account: "Account",
    catalog: "Catalog",
    taxes: "Taxes",
    payments: "Payments",
    team: "Team",
    scheduling: "Scheduling",
    booking: "Booking",
};

export function SettingsScreen() {
    const nav = useNavigation<Nav>();
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <View style={styles.group}>
                {SETTINGS_SECTIONS.map((s, i) => (
                    <Pressable
                        key={s.key}
                        style={[styles.row, i > 0 ? styles.rowBorder : null]}
                        onPress={() => {
                            nav.navigate(SECTION_SCREEN[s.key]);
                        }}
                    >
                        <Text style={styles.rowLabel}>{s.label}</Text>
                        <IconChevron size={18} color={theme.colors.muted} />
                    </Pressable>
                ))}
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.bg },
    content: { padding: 16 },
    group: {
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: theme.colors.border,
        overflow: "hidden",
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 15,
    },
    rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
    rowLabel: { color: theme.colors.ink, fontSize: 15, fontWeight: "500" },
});
