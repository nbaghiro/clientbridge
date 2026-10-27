import {
    DESTINATIONS,
    DESTINATION_ICON,
    type DestinationKey,
    strings,
    usePlanNotice,
    useShellNav,
    useSyncState,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActionMenu, Icon, Notice, SyncBanner, confirm, useTabletLayout } from "@clientbridge/ui";

import { api } from "../lib/api";
import { useViewer } from "../lib/auth";
import { useOpenLink } from "../lib/links";
import { connectPowerSync } from "../lib/powersync";

const c = theme.colors;

const TAB_DESTINATION: Record<string, DestinationKey> = {
    Today: "today",
    Schedule: "schedule",
    Clients: "clients",
    Inbox: "inbox",
};

const destination = (name: string): DestinationKey => TAB_DESTINATION[name] ?? "today";

export function ShellBanners() {
    const { notice, rejectedCount, discardRejected } = useSyncState();
    const plan = usePlanNotice(useViewer()?.role ?? null);
    return (
        <>
            {notice !== null ? (
                <SyncBanner
                    state={notice.state}
                    title={notice.title}
                    detail={notice.detail}
                    action={
                        rejectedCount > 0
                            ? {
                                  label: strings.sync.discardRejected,
                                  onPress: () => {
                                      confirm({
                                          title: strings.sync.discardRejected,
                                          message: strings.sync.discardRejectedDetail,
                                          confirmLabel: strings.sync.discardRejected,
                                          destructive: true,
                                      })
                                          .then(async (ok) => {
                                              if (ok) await discardRejected();
                                          })
                                          .catch(() => undefined);
                                  },
                              }
                            : notice.retry
                              ? {
                                    label: strings.sync.retry,
                                    onPress: () => {
                                        connectPowerSync(api).catch(() => undefined);
                                    },
                                }
                              : undefined
                    }
                />
            ) : null}
            {plan !== null ? (
                <Notice tone={plan.tone} banner>
                    {plan.message}
                </Notice>
            ) : null}
        </>
    );
}

export function TabBar(props: BottomTabBarProps) {
    return <BottomBar {...props} />;
}

function BottomBar({ state, navigation }: BottomTabBarProps) {
    const insets = useSafeAreaInsets();
    const tablet = useTabletLayout();
    const nav = useShellNav(useViewer());
    const openLink = useOpenLink();
    const [menu, setMenu] = useState(false);
    const [anchor, setAnchor] = useState<{ x: number; y: number } | undefined>(undefined);
    const fab = useRef<View>(null);
    const close = (): void => {
        setMenu(false);
    };

    return (
        <View>
            {tablet ? null : <ShellBanners />}
            <View
                style={
                    tablet
                        ? [styles.bar, styles.floating, { marginBottom: insets.bottom + 8 }]
                        : [styles.bar, { paddingBottom: insets.bottom + 6 }]
                }
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
                                <Icon name={DESTINATION_ICON[key]} size={23} color={color} />
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
                                ref={fab}
                                style={styles.fab}
                                accessibilityRole="button"
                                accessibilityLabel={strings.navigation.createMenu}
                                onPress={() => {
                                    fab.current?.measureInWindow((x, y, width, height) => {
                                        setAnchor({ x: x + width / 2, y: y + height / 2 });
                                        setMenu(true);
                                    });
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
                    layout="radial"
                    anchor={anchor}
                    items={nav.quickCreate}
                    onSelect={(key) => {
                        close();
                        const action = nav.quickCreate.find((a) => a.key === key);
                        if (action === undefined) return;
                        openLink(action.target);
                    }}
                />
            </View>
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
    label: { fontFamily: theme.fonts.ui, fontSize: 10.5, fontWeight: "600" },
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
    badgeText: { color: c.surface, fontFamily: theme.fonts.ui, fontSize: 9.5, fontWeight: "700" },
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
    // On a tablet the phone bar floats as a capsule below the page card.
    floating: {
        alignSelf: "center",
        width: 520,
        paddingBottom: 8,
        borderRadius: 32,
        borderTopWidth: 0,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        shadowColor: c.ink,
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
    },
});
