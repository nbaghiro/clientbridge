import { strings, useNotifications } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Button, Choice, Empty, IconButton, ListRow, LoadFailed, Skeleton } from "@clientbridge/ui";
import { useNavigation } from "@react-navigation/native";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useViewer } from "../lib/auth";
import { useOpenLink } from "../lib/links";

const c = theme.colors;
const t = strings.notifications;

/** The bell on a phone: the last week of what happened, grouped by day. */
export function NotificationsScreen() {
    const view = useNotifications(useViewer());
    const nav = useNavigation();
    const openLink = useOpenLink();

    return (
        <SafeAreaView style={styles.screen} edges={["top"]}>
            <View style={styles.bar}>
                <IconButton
                    icon="chevronLeft"
                    label={strings.common.close}
                    onPress={() => {
                        nav.goBack();
                    }}
                />
                <Text style={styles.barTitle} accessibilityRole="header">
                    {t.title}
                </Text>
                <View style={styles.barSpacer} />
            </View>
            <View style={styles.filters}>
                <Choice
                    layout="segmented"
                    label={t.filterBy}
                    value={view.filter}
                    onChange={view.setFilter}
                    options={[
                        { key: "all", label: t.all },
                        { key: "unread", label: t.unreadCount(view.unread) },
                    ]}
                />
                <Button
                    style={{ alignSelf: "center" }}
                    size="sm"
                    variant="link"
                    disabled={view.unread === 0}
                    onPress={view.markAllRead}
                >
                    {t.markAllRead}
                </Button>
            </View>
            <ScrollView contentContainerStyle={styles.body}>
                {view.load.state === "loading" ? (
                    <View style={styles.card}>
                        <Skeleton variant="row" count={6} label={t.loading} />
                    </View>
                ) : view.load.state === "error" ? (
                    <LoadFailed onRetry={view.load.retry} retrying={view.load.retrying} />
                ) : view.groups.length === 0 ? (
                    <Empty
                        icon="bell"
                        message={view.filter === "unread" ? t.emptyUnread : t.empty}
                        body={t.emptyHint}
                    />
                ) : (
                    view.groups.map((g) => (
                        <View key={g.key}>
                            <Text style={styles.head}>{g.label}</Text>
                            <View style={styles.card}>
                                {g.items.map((n, i) => (
                                    <View key={n.id} style={i > 0 ? styles.divider : undefined}>
                                        <ListRow
                                            unread={!n.read}
                                            icon={n.icon}
                                            intent={n.intent}
                                            title={n.title}
                                            detail={n.body}
                                            meta={n.when}
                                            label={
                                                n.read
                                                    ? t.readLabel(n.title, n.body)
                                                    : t.unreadLabel(n.title, n.body)
                                            }
                                            onPress={() => {
                                                view.markRead(n.id);
                                                openLink(
                                                    n.link,
                                                    n.kind === "invoice_overdue" ||
                                                        n.kind === "message"
                                                        ? n.refId
                                                        : null,
                                                );
                                            }}
                                        />
                                    </View>
                                ))}
                            </View>
                        </View>
                    ))
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    bar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingBottom: 4 },
    barTitle: { flex: 1, textAlign: "center", color: c.ink, fontSize: 17, fontWeight: "700" },
    barSpacer: { width: 44 },
    filters: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    body: { paddingHorizontal: 16, paddingBottom: 32 },
    head: {
        color: c.muted,
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        marginTop: 14,
        marginBottom: 8,
        marginLeft: 4,
    },
    card: {
        backgroundColor: c.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c.border,
        overflow: "hidden",
    },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
});
