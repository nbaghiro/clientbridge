import { theme } from "@clientbridge/tokens/theme";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconCalendar, IconClients, IconInbox, IconPlus, IconToday } from "./icons";

function tabIcon(name: string, color: string): ReactElement {
    if (name === "Calendar") return <IconCalendar size={23} color={color} />;
    if (name === "Clients") return <IconClients size={23} color={color} />;
    if (name === "Inbox") return <IconInbox size={23} color={color} />;
    return <IconToday size={23} color={color} />;
}

export function TabBar({ state, navigation }: BottomTabBarProps) {
    const insets = useSafeAreaInsets();
    return (
        <View style={[styles.bar, { paddingBottom: insets.bottom + 6 }]}>
            {state.routes.map((route, i) => {
                const focused = state.index === i;
                const color = focused ? theme.colors.accent : theme.colors.muted;
                const tab = (
                    <Pressable
                        key={route.key}
                        style={styles.tab}
                        onPress={() => {
                            navigation.navigate(route.name);
                        }}
                    >
                        {tabIcon(route.name, color)}
                        <Text style={[styles.label, { color }]}>{route.name}</Text>
                    </Pressable>
                );
                if (i === 1) {
                    return [
                        tab,
                        <Pressable
                            key="fab"
                            style={styles.fab}
                            onPress={() => {
                                navigation.navigate("Clients");
                            }}
                        >
                            <IconPlus size={26} color="#fff" />
                        </Pressable>,
                    ];
                }
                return tab;
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    bar: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: theme.colors.surface,
        borderTopColor: theme.colors.border,
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingTop: 8,
    },
    tab: { flex: 1, alignItems: "center", gap: 3 },
    label: { fontSize: 10.5, fontWeight: "600" },
    fab: {
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: theme.colors.accent,
        alignItems: "center",
        justifyContent: "center",
        marginHorizontal: 8,
        marginTop: -22,
        shadowColor: "#000",
        shadowOpacity: 0.2,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
    },
});
