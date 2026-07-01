import { strings } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { type ReactElement, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BookingForm } from "./BookingForm";
import { IconCalendar, IconClients, IconInbox, IconPlus, IconPos, IconToday } from "./icons";

function tabIcon(name: string, color: string): ReactElement {
    if (name === "Calendar") return <IconCalendar size={23} color={color} />;
    if (name === "Clients") return <IconClients size={23} color={color} />;
    if (name === "Inbox") return <IconInbox size={23} color={color} />;
    return <IconToday size={23} color={color} />;
}

export function TabBar({ state, navigation }: BottomTabBarProps) {
    const insets = useSafeAreaInsets();
    const [menu, setMenu] = useState(false);
    const [booking, setBooking] = useState(false);

    const go = (tab: string): void => {
        setMenu(false);
        navigation.navigate(tab);
    };

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
                                setMenu(true);
                            }}
                        >
                            <IconPlus size={26} color="#fff" />
                        </Pressable>,
                    ];
                }
                return tab;
            })}

            <Modal
                visible={menu}
                transparent
                animationType="fade"
                onRequestClose={() => {
                    setMenu(false);
                }}
            >
                <Pressable
                    style={styles.backdrop}
                    onPress={() => {
                        setMenu(false);
                    }}
                >
                    <View style={styles.sheet} onStartShouldSetResponder={() => true}>
                        <Text style={styles.sheetTitle}>{strings.nav.createMenu}</Text>
                        <Pressable
                            style={styles.menuRow}
                            onPress={() => {
                                go("Clients");
                            }}
                        >
                            <IconClients size={20} color={theme.colors.accent} />
                            <Text style={styles.menuText}>{strings.nav.newClient}</Text>
                        </Pressable>
                        <Pressable
                            style={styles.menuRow}
                            onPress={() => {
                                setMenu(false);
                                setBooking(true);
                            }}
                        >
                            <IconCalendar size={20} color={theme.colors.accent} />
                            <Text style={styles.menuText}>{strings.nav.newBooking}</Text>
                        </Pressable>
                        <Pressable
                            style={styles.menuRow}
                            onPress={() => {
                                go("Invoices");
                            }}
                        >
                            <IconInbox size={20} color={theme.colors.accent} />
                            <Text style={styles.menuText}>{strings.nav.invoices}</Text>
                        </Pressable>
                        <Pressable
                            style={styles.menuRow}
                            onPress={() => {
                                go("POS");
                            }}
                        >
                            <IconPos size={20} color={theme.colors.accent} />
                            <Text style={styles.menuText}>{strings.nav.newSale}</Text>
                        </Pressable>
                    </View>
                </Pressable>
            </Modal>

            <BookingForm
                visible={booking}
                onClose={() => {
                    setBooking(false);
                }}
            />
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
    backdrop: { flex: 1, backgroundColor: theme.colors.scrim, justifyContent: "flex-end" },
    sheet: {
        backgroundColor: theme.colors.surface,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        paddingHorizontal: 20,
        paddingTop: 18,
        paddingBottom: 36,
        gap: 4,
    },
    sheetTitle: {
        color: theme.colors.muted,
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        marginBottom: 8,
    },
    menuRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 13 },
    menuText: { color: theme.colors.ink, fontSize: 16, fontWeight: "600" },
    menuDisabled: { opacity: 0.5 },
    menuTextDisabled: { color: theme.colors.muted, fontSize: 16, fontWeight: "500" },
});
