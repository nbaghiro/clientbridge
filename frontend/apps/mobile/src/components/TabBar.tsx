import {
    DESTINATIONS,
    DESTINATION_ICON,
    DESTINATION_TARGET,
    type DestinationKey,
    mediaUrl,
    strings,
    usePeoplePhotos,
    usePlanNotice,
    useShellNav,
    useSyncState,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
    ActionMenu,
    Avatar,
    Badge,
    Button,
    Icon,
    IconButton,
    Notice,
    SyncBanner,
    confirm,
    useTabletLayout,
} from "@clientbridge/ui";

import { api, apiBaseUrl } from "../lib/api";
import { useUserId, useViewer } from "../lib/auth";
import { useOpenLink } from "../lib/links";
import { connectPowerSync } from "../lib/powersync";
import { useSignOut } from "../lib/session";

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
    return useTabletLayout() ? <Sidebar {...props} /> : <BottomBar {...props} />;
}

function BottomBar({ state, navigation }: BottomTabBarProps) {
    const insets = useSafeAreaInsets();
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
            <ShellBanners />
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

function Sidebar({ state, navigation }: BottomTabBarProps) {
    const insets = useSafeAreaInsets();
    const nav = useShellNav(useViewer());
    const photos = usePeoplePhotos();
    const userId = useUserId();
    const openLink = useOpenLink();
    const signOut = useSignOut();
    const [menu, setMenu] = useState<"create" | "account" | null>(null);
    const n = strings.navigation;
    const close = (): void => {
        setMenu(null);
    };
    const route = state.routes[state.index];
    const focused = route === undefined ? "today" : destination(route.name);
    const nextStep = nav.setup.steps.find((s) => !s.done);

    return (
        <View
            style={[
                styles.side,
                {
                    paddingTop: insets.top + 12,
                    paddingBottom: insets.bottom + 8,
                    paddingLeft: insets.left,
                },
            ]}
        >
            <View style={styles.sidePad}>
                <Pressable
                    style={({ pressed }) => [styles.business, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={n.businessMenu}
                    onPress={() => {
                        openLink("business");
                    }}
                >
                    <Avatar
                        name={nav.setup.businessName}
                        size="sm"
                        color={nav.brandColor}
                        variant="mark"
                        src={
                            nav.setup.logoFileId ? mediaUrl(apiBaseUrl, nav.setup.logoFileId) : null
                        }
                    />
                    <Text style={styles.businessName} numberOfLines={1}>
                        {nav.setup.businessName}
                    </Text>
                    <Icon name="chevronDown" size={15} color={c.muted} />
                </Pressable>
                <View style={styles.actions}>
                    <Button
                        full
                        icon="plus"
                        onPress={() => {
                            setMenu("create");
                        }}
                    >
                        {n.createMenu}
                    </Button>
                    <Button
                        full
                        variant="outline"
                        icon="search"
                        onPress={() => {
                            navigation.navigate("Search");
                        }}
                    >
                        {n.search}
                    </Button>
                </View>
            </View>

            <ScrollView
                style={styles.fill}
                contentContainerStyle={styles.links}
                accessibilityRole="tablist"
                accessibilityLabel={n.main}
            >
                {DESTINATIONS.map(({ key, label }) => {
                    const selected = focused === key && key !== "payments";
                    const badge = nav.badges[key];
                    return (
                        <Pressable
                            key={key}
                            testID={`tab-${key}`}
                            style={({ pressed }) => [
                                styles.link,
                                selected && styles.linkSelected,
                                pressed && !selected && styles.pressed,
                            ]}
                            accessibilityRole="tab"
                            accessibilityState={{ selected }}
                            accessibilityLabel={
                                badge !== undefined && badge > 0
                                    ? strings.ui.withCount(label, String(badge))
                                    : label
                            }
                            onPress={() => {
                                openLink(DESTINATION_TARGET[key]);
                            }}
                        >
                            <Icon
                                name={DESTINATION_ICON[key]}
                                size={18}
                                color={selected ? c.accent : c.inkSoft}
                            />
                            <Text
                                style={[styles.linkLabel, selected && styles.linkLabelSelected]}
                                numberOfLines={1}
                            >
                                {label}
                            </Text>
                            {badge !== undefined && badge > 0 ? (
                                <Badge label={badge} variant="count" />
                            ) : null}
                        </Pressable>
                    );
                })}
            </ScrollView>

            {nav.showSetup ? (
                <Pressable
                    style={({ pressed }) => [styles.setupCard, pressed && styles.pressed]}
                    accessibilityRole="button"
                    onPress={() => {
                        if (nextStep === undefined) navigation.navigate("Setup");
                        else openLink(nextStep.target);
                    }}
                >
                    <View style={styles.setupHead}>
                        <Text style={styles.setupTitle}>{n.finishSetup}</Text>
                        <Text style={styles.setupCount}>
                            {n.setupProgress(nav.setup.done, nav.setup.total)}
                        </Text>
                    </View>
                    <View style={styles.track}>
                        <View style={[styles.progress, { flex: nav.setup.done }]} />
                        <View style={{ flex: nav.setup.total - nav.setup.done }} />
                    </View>
                </Pressable>
            ) : null}

            <View style={styles.foot}>
                <Pressable
                    style={({ pressed }) => [styles.link, pressed && styles.pressed]}
                    accessibilityRole="button"
                    onPress={() => {
                        navigation.navigate("Setup");
                    }}
                >
                    <Icon name="settings" size={18} color={c.inkSoft} />
                    <Text style={styles.linkLabel}>{n.setup}</Text>
                </Pressable>
                <View style={styles.account}>
                    <Avatar name={nav.name} src={photos.user(userId)} size="sm" color={nav.color} />
                    <View style={styles.fill}>
                        <Text style={styles.accountName} numberOfLines={1}>
                            {nav.name}
                        </Text>
                        <Text style={styles.accountRole} numberOfLines={1}>
                            {nav.roleLabel}
                        </Text>
                    </View>
                    <IconButton
                        icon="more"
                        label={n.accountMenu}
                        size="sm"
                        pressed={menu === "account"}
                        onPress={() => {
                            setMenu("account");
                        }}
                    />
                </View>
            </View>

            <ActionMenu
                open={menu === "create"}
                onClose={close}
                title={n.createMenu}
                items={nav.quickCreate}
                onSelect={(key) => {
                    close();
                    const action = nav.quickCreate.find((a) => a.key === key);
                    if (action !== undefined) openLink(action.target);
                }}
            />
            <ActionMenu
                open={menu === "account"}
                onClose={close}
                title={nav.name}
                items={[
                    { key: "hours", label: n.yourHours, icon: "clock" },
                    { key: "signOut", label: n.signOut, icon: "logout" },
                ]}
                onSelect={(key) => {
                    close();
                    if (key === "signOut") signOut();
                    else openLink("hours");
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
    side: {
        width: theme.layout.sidebar,
        backgroundColor: c.surface,
        borderRightColor: c.border,
        borderRightWidth: StyleSheet.hairlineWidth,
    },
    sidePad: { paddingHorizontal: 12, gap: 12 },
    fill: { flex: 1, minWidth: 0 },
    pressed: { backgroundColor: c.bg },
    business: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        borderRadius: theme.radius,
        paddingHorizontal: 8,
        paddingVertical: 6,
    },
    businessName: {
        flex: 1,
        minWidth: 0,
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: 14,
        fontWeight: "600",
    },
    actions: { gap: 8 },
    links: { paddingHorizontal: 12, paddingVertical: 12, gap: 2 },
    link: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderRadius: theme.radius,
        paddingHorizontal: 12,
        paddingVertical: 9,
    },
    linkSelected: { backgroundColor: c.accentWeak },
    linkLabel: {
        flex: 1,
        color: c.inkSoft,
        fontFamily: theme.fonts.ui,
        fontSize: 14,
        fontWeight: "500",
    },
    linkLabelSelected: { color: c.accent, fontWeight: "600" },
    setupCard: {
        marginHorizontal: 12,
        marginBottom: 12,
        borderRadius: theme.radius,
        borderWidth: theme.borderWidth,
        borderColor: c.borderSoft,
        backgroundColor: c.bg,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    setupHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    setupTitle: { color: c.ink, fontFamily: theme.fonts.ui, fontSize: 12, fontWeight: "600" },
    setupCount: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 12, fontWeight: "500" },
    track: {
        flexDirection: "row",
        marginTop: 8,
        height: 6,
        borderRadius: 3,
        overflow: "hidden",
        backgroundColor: c.surface2,
    },
    progress: { borderRadius: 3, backgroundColor: c.accent },
    foot: {
        borderTopColor: c.border,
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 12,
        paddingTop: 12,
    },
    account: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        marginTop: 8,
        paddingHorizontal: 8,
        paddingVertical: 6,
    },
    accountName: { color: c.ink, fontFamily: theme.fonts.ui, fontSize: 14, fontWeight: "500" },
    accountRole: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 12 },
});
