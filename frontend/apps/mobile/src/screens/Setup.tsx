import { type SetupSectionKey, setupSectionsFor, strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Icon } from "@clientbridge/ui";

import { useRole } from "../lib/auth";
import { useSignOut } from "../lib/session";
import type { RootStackParamList } from "../navigation";
import { Business } from "./Business";
import { Hours } from "./Hours";
import { Taxes } from "./Taxes";
import { Team } from "./Team";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const SECTION_SCREEN: Partial<Record<SetupSectionKey, keyof RootStackParamList>> = {
    business: "Business",
    services: "Services",
    team: "Team",
    gettingPaid: "GettingPaid",
    onlineBooking: "OnlineBooking",
    reminders: "Reminders",
};

export function SetupScreen() {
    const nav = useNavigation<Nav>();
    const role = useRole();
    const signOut = useSignOut();
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <View style={styles.group}>
                {setupSectionsFor("mobile", role).map((s, i) => (
                    <Pressable
                        key={s.key}
                        style={[styles.row, i > 0 ? styles.rowBorder : null]}
                        onPress={() => {
                            const screen = SECTION_SCREEN[s.key];
                            if (screen !== undefined) nav.navigate(screen);
                        }}
                    >
                        <Text style={styles.rowLabel}>{s.label}</Text>
                        <Icon name="chevron" size={18} color={theme.colors.muted} />
                    </Pressable>
                ))}
            </View>
            <View style={styles.signOut}>
                <Button variant="quiet" icon="logout" onPress={signOut}>
                    {strings.navigation.signOut}
                </Button>
            </View>
        </ScrollView>
    );
}

export function BusinessScreen() {
    return <Business footer={<Taxes />} />;
}

export function TeamHoursScreen() {
    return <Team footer={<Hours />} />;
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
    signOut: { alignItems: "center", paddingTop: 24 },
});
