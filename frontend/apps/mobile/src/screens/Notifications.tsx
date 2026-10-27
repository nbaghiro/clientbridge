import { strings, useNotifications } from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Button, Choice, Empty, ListRow, LoadFailed, Panel, Skeleton } from "@clientbridge/ui";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { useViewer } from "../lib/auth";
import { useOpenLink } from "../lib/links";

const c = theme.colors;
const t = strings.notifications;

/** The bell on a phone: the last week of what happened, grouped by day. */
export function NotificationsScreen() {
    const view = useNotifications(useViewer());
    const openLink = useOpenLink();

    return (
        <View style={styles.screen}>
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
                    <Panel flush>
                        <Skeleton variant="row" count={6} label={t.loading} />
                    </Panel>
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
                            <Panel flush>
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
                            </Panel>
                        </View>
                    ))
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
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
        fontFamily: theme.fonts.ui,
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        marginTop: 14,
        marginBottom: 8,
        marginLeft: 4,
    },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
});
