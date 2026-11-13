import {
    type SetupSectionKey,
    setupSectionsFor,
    strings,
    mediaUrl,
    useBusinessSwitch,
    useSetupProgress,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { type RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Avatar, Button, Icon, Select, Skeleton } from "@clientbridge/ui";

import { apiBaseUrl } from "../lib/api";
import { useRole } from "../lib/auth";
import { useOpenLink } from "../lib/links";
import { useSignOut } from "../lib/session";
import type { RootStackParamList } from "../navigation";
import { Business } from "./Business";
import { Hours } from "./Hours";
import { Team } from "./Team";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const SECTION_SCREEN: Partial<
    Record<
        SetupSectionKey,
        | "GetSetUp"
        | "Business"
        | "Services"
        | "Team"
        | "GettingPaid"
        | "Taxes"
        | "OnlineBooking"
        | "Reminders"
        | "Resources"
        | "Security"
    >
> = {
    start: "GetSetUp",
    business: "Business",
    services: "Services",
    resources: "Resources",
    team: "Team",
    gettingPaid: "GettingPaid",
    taxes: "Taxes",
    onlineBooking: "OnlineBooking",
    reminders: "Reminders",
    security: "Security",
};

export function SetupScreen() {
    const nav = useNavigation<Nav>();
    const role = useRole();
    const business = useSetupProgress();
    const picker = useBusinessSwitch();
    const signOut = useSignOut();
    const openLink = useOpenLink();
    if (role === null) {
        return (
            <View style={styles.content}>
                <Skeleton variant="row" count={7} label={strings.common.loading} />
            </View>
        );
    }
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <View style={styles.identity}>
                <Avatar
                    name={business.businessName}
                    size="lg"
                    color={business.brandColor}
                    src={business.logoFileId ? mediaUrl(apiBaseUrl, business.logoFileId) : null}
                    variant="mark"
                />
                <Text style={styles.rowLabel}>{business.businessName}</Text>
            </View>
            {picker !== null ? (
                <View style={styles.switcher}>
                    <Select
                        label={strings.business.selectBusiness}
                        options={picker.options}
                        value={picker.selectedId ?? undefined}
                        onChange={picker.choose}
                        disabled={picker.busy}
                        error={picker.error}
                        surface="surface"
                    />
                </View>
            ) : null}
            <View style={[styles.group, styles.payments]}>
                <Pressable
                    style={styles.row}
                    accessibilityRole="button"
                    onPress={() => {
                        openLink("payments");
                    }}
                >
                    <Text style={styles.rowLabel}>{strings.navigation.payments}</Text>
                    <Icon name="chevron" size={18} color={theme.colors.muted} />
                </Pressable>
            </View>
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
    return <Business />;
}

export function TeamHoursScreen() {
    const route = useRoute<RouteProp<RootStackParamList, "Team">>();
    return <Team footer={<Hours />} showFooter={route.params?.hours === true} />;
}

const styles = StyleSheet.create({
    identity: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
    screen: { flex: 1 },
    content: { padding: 16 },
    payments: { marginBottom: 16 },
    switcher: { marginBottom: 16 },
    group: {
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius,
        borderWidth: theme.borderWidth,
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
    rowLabel: {
        color: theme.colors.ink,
        fontFamily: theme.fonts.ui,
        fontSize: 15,
        fontWeight: "500",
    },
    signOut: { flexDirection: "row", justifyContent: "center", paddingTop: 24 },
});
