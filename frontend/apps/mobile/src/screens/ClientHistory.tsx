import {
    type ClientHistoryFilter,
    formatRelativeTime,
    strings,
    toTimeline,
    useClientHistory,
    useBusinessZone,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    ActivityTimeline,
    Button,
    Empty,
    Icon,
    LoadFailed,
    Panel,
    Skeleton,
    Tabs,
} from "@clientbridge/ui";
import { type RouteProp, useRoute } from "@react-navigation/native";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { useViewer } from "../lib/auth";
import type { RootStackParamList } from "../navigation";

import { NoteSheet } from "../components/ClientSheets";

const c = theme.colors;
const h = strings.clients.history;

/** One client's history: pinned notes, a note box, and the timeline by month with filters. */
export function ClientHistoryScreen() {
    const zone = useBusinessZone();
    const { clientId } = useRoute<RouteProp<RootStackParamList, "ClientHistory">>().params;
    const viewer = useViewer();
    const hist = useClientHistory(clientId, viewer?.staffId ?? null);
    const [composing, setComposing] = useState(false);
    const now = new Date();

    return (
        <View style={styles.screen}>
            {hist.load.ready ? (
                <Tabs<ClientHistoryFilter>
                    variant="pill"
                    items={hist.filters.map((f) => ({
                        key: f.key,
                        label: h.withCount(f.label, f.hint),
                    }))}
                    active={hist.filter}
                    onSelect={hist.setFilter}
                />
            ) : null}
            <ScrollView contentContainerStyle={styles.body}>
                {hist.load.state === "loading" ? (
                    <Skeleton variant="row" count={5} label={h.loading} />
                ) : null}
                {hist.load.state === "error" ? (
                    <LoadFailed
                        message={h.loadError}
                        onRetry={hist.load.retry}
                        retrying={hist.load.retrying}
                    />
                ) : null}
                {hist.pinned.map((n) => (
                    <View key={n.id} style={styles.pinned}>
                        <View style={styles.row}>
                            <Icon name="alert" size={14} color={c.warnFg} />
                            <Text style={styles.pinnedTitle}>{h.headsUp}</Text>
                        </View>
                        <Text style={styles.pinnedBody}>{n.body}</Text>
                        <Text style={styles.pinnedMeta}>
                            {h.by(n.author, formatRelativeTime(n.at.toISOString(), zone, now))}
                        </Text>
                    </View>
                ))}
                {hist.load.hasData ? (
                    <Button
                        full
                        variant="outline"
                        icon="edit"
                        onPress={() => {
                            setComposing(true);
                        }}
                    >
                        {h.saveNote}
                    </Button>
                ) : null}
                {hist.filter === "all" && hist.upcoming.length > 0 ? (
                    <View style={styles.group}>
                        <Text style={styles.groupLabel}>{h.upcoming}</Text>
                        <Panel style={styles.cardAccent}>
                            <ActivityTimeline
                                entries={hist.upcoming.map((e) => toTimeline(e, zone))}
                            />
                        </Panel>
                    </View>
                ) : null}
                {hist.load.state === "empty" ? (
                    <Empty icon="history" message={h.emptyTitle} body={h.empty} />
                ) : null}
                {hist.load.ready && hist.groups.length === 0 ? (
                    <Empty message={hist.total === 0 ? h.empty : h.emptyFilter} />
                ) : null}
                {hist.groups.map((g) => (
                    <View key={g.key} style={styles.group}>
                        <Text style={styles.groupLabel}>{g.label}</Text>
                        <Panel>
                            <ActivityTimeline entries={g.entries.map((e) => toTimeline(e, zone))} />
                        </Panel>
                    </View>
                ))}
                {hist.hasOlder ? (
                    <View style={styles.group}>
                        <Button full variant="outline" onPress={hist.showOlder}>
                            {h.loadOlder}
                        </Button>
                    </View>
                ) : null}
            </ScrollView>
            {composing ? (
                <NoteSheet
                    clientId={clientId}
                    subjects={hist.subjects}
                    onClose={() => {
                        setComposing(false);
                    }}
                />
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    body: { padding: 16, paddingBottom: 32, gap: 12 },
    row: { flexDirection: "row", alignItems: "center", gap: 6 },
    pinned: { backgroundColor: c.warnBg, borderRadius: theme.radius, padding: 12 },
    pinnedTitle: {
        color: c.warnFg,
        fontFamily: theme.fonts.ui,
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.5,
        textTransform: "uppercase",
    },
    pinnedBody: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: 14,
        lineHeight: 20,
        marginTop: 6,
    },
    pinnedMeta: { color: c.warnFg, fontFamily: theme.fonts.ui, fontSize: 12, marginTop: 4 },
    group: { marginTop: 6 },
    groupLabel: {
        color: c.muted,
        fontFamily: theme.fonts.ui,
        fontSize: 12,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 8,
    },
    cardAccent: { borderColor: c.accentLine },
});
