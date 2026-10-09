import {
    DESTINATIONS,
    type DestinationKey,
    type IconName,
    strings,
    useShellNav,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActionMenu, Icon } from "@clientbridge/ui";

import { useViewer } from "../lib/auth";
import { useOpenLink } from "../lib/links";

const c = theme.colors;

const TAB_DESTINATION: Record<string, DestinationKey> = {
    Today: "today",
    Schedule: "schedule",
    Clients: "clients",
    Inbox: "inbox",
};

const TAB_ICON: Record<DestinationKey, IconName> = {
    today: "today",
    schedule: "calendar",
    clients: "clients",
    payments: "invoices",
    inbox: "inbox",
};

const destination = (name: string): DestinationKey => TAB_DESTINATION[name] ?? "today";

export function TabBar({ state, navigation }: BottomTabBarProps) {
    const insets = useSafeAreaInsets();
    const nav = useShellNav(useViewer());
    const openLink = useOpenLink();
    const [menu, setMenu] = useState(false);
    const close = (): void => {
        setMenu(false);
    };

    return (
        <View
            style={[styles.bar, { paddingBottom: insets.bottom + 6 }]}
            accessibilityRole="tablist"
        >
            {state.routes.map((route, i) => {
                const focused = state.index === i;
                const color = focused ? c.accent : c.muted;
                const key = destination(route.name);
                const label = DESTINATIONS.find((d) => d.key === key)?.label ?? route.name;
                const badge = nav.badges[key];
                const tab = (
                    <Pressable
                        key={route.key}
                        testID={`tab-${key}`}
                        style={styles.tab}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: focused }}
                        accessibilityLabel={
                            badge !== undefined && badge > 0
                                ? strings.ui.withCount(label, String(badge))
                                : label
                        }
                        onPress={() => {
                            navigation.navigate(route.name);
                        }}
                    >
                        <View>
                            <Icon name={TAB_ICON[key]} size={23} color={color} />
                            {badge !== undefined && badge > 0 ? (
                                <View style={styles.badge}>
                                    <Text style={styles.badgeText}>
                                        {badge > 99 ? "99+" : badge}
                                    </Text>
                                </View>
                            ) : null}
                        </View>
                        <Text style={[styles.label, { color }]}>{label}</Text>
                    </Pressable>
                );
                if (i === 1) {
                    return [
                        tab,
                        <Pressable
                            key="fab"
                            style={styles.fab}
                            accessibilityRole="button"
                            accessibilityLabel={strings.navigation.createMenu}
                            onPress={() => {
                                setMenu(true);
                            }}
                        >
                            <Icon name="plus" size={26} color={c.surface} />
                        </Pressable>,
                    ];
                }
                return tab;
            })}

            <ActionMenu
                open={menu}
                onClose={close}
                title={strings.navigation.createMenu}
                layout="grid"
                items={nav.create}
                onSelect={(key) => {
                    close();
                    const action = nav.create.find((a) => a.key === key);
                    if (action === undefined) return;
                    openLink(action.target);
                }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    bar: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: c.surface,
        borderTopColor: c.border,
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingTop: 8,
    },
    tab: { flex: 1, alignItems: "center", gap: 3 },
    label: { fontSize: 10.5, fontWeight: "600" },
    badge: {
        position: "absolute",
        top: -4,
        right: -9,
        minWidth: 17,
        height: 17,
        borderRadius: 9,
        paddingHorizontal: 4,
        backgroundColor: c.danFg,
        borderWidth: 2,
        borderColor: c.surface,
        alignItems: "center",
        justifyContent: "center",
    },
    badgeText: { color: c.surface, fontSize: 9.5, fontWeight: "700" },
    fab: {
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: c.accent,
        alignItems: "center",
        justifyContent: "center",
        marginHorizontal: 8,
        marginTop: -22,
        shadowColor: c.ink,
        shadowOpacity: 0.2,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
    },
});
