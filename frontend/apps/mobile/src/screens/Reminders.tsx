import {
    type ScheduleEvent,
    strings,
    useReminderSettings,
    formatParts,
    useBusinessZone,
    formatWeekdayTime,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Button,
    Choice,
    LoadFailed,
    MessageBubble,
    Notice,
    Skeleton,
    Stat,
    Panel,
} from "@clientbridge/ui";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";

const c = theme.colors;
const s = strings.reminders;

/** The reminder every visit gets, word for word, and the visits still open at the end of the day. */
export function RemindersScreen() {
    const r = useReminderSettings(api);
    const [channel, setChannel] = useState<"sms" | "email">("sms");
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
            <Text style={styles.muted}>{s.subtitle}</Text>
            {r.load.state === "loading" ? (
                <Skeleton variant="row" count={5} label={s.loading} />
            ) : r.load.state === "error" ? (
                <LoadFailed
                    message={s.loadError}
                    onRetry={r.load.retry}
                    retrying={r.load.retrying}
                />
            ) : (
                <>
                    <Panel style={styles.card} title={s.remindersTitle}>
                        <Text style={styles.muted}>{s.remindersHint}</Text>
                        <Text style={styles.soft}>{s.rule}</Text>
                        {r.manageLink ? <Text style={styles.soft}>{s.includeLink}</Text> : null}
                    </Panel>
                    <Panel
                        style={styles.card}
                        title={s.preview}
                        actions={
                            <Choice
                                layout="segmented"
                                label={s.preview}
                                options={[
                                    { key: "sms" as const, label: s.channelSms },
                                    { key: "email" as const, label: s.channelEmail },
                                ]}
                                value={channel}
                                onChange={setChannel}
                            />
                        }
                    >
                        {r.previewLoading ? (
                            <Skeleton variant="line" count={3} label={s.loading} />
                        ) : r.preview === null ? (
                            <Text style={styles.muted}>{s.previewNone}</Text>
                        ) : (
                            <>
                                <Text style={styles.muted}>{s.previewVisit(r.preview.who)}</Text>
                                {channel === "sms" ? (
                                    <MessageBubble
                                        direction="in"
                                        width="full"
                                        body={r.preview.body}
                                        meta={r.preview.sendsAt}
                                    />
                                ) : (
                                    <View style={styles.email}>
                                        <Text style={styles.value}>{r.preview.subject}</Text>
                                        <Text style={styles.soft}>{r.preview.body}</Text>
                                        <Text style={styles.muted}>{r.preview.sendsAt}</Text>
                                    </View>
                                )}
                            </>
                        )}
                    </Panel>
                    <Panel style={styles.card}>
                        <Stat
                            label={formatParts([s.deliveryTitle, s.sent])}
                            value={s.sentCount(r.sentWeek)}
                        />
                    </Panel>
                    <Panel style={styles.card} title={s.endOfDayTitle}>
                        <Text style={styles.muted}>
                            {r.autoComplete ? s.endOfDayAuto : s.endOfDayHint}
                        </Text>
                        <Text style={styles.value}>{s.openToday(r.openToday.length)}</Text>
                        <OpenVisits visits={r.openToday} r={r} />
                        {r.openEarlier.length > 0 ? (
                            <>
                                <Text style={styles.value}>{s.openEarlier}</Text>
                                <OpenVisits visits={r.openEarlier} r={r} />
                            </>
                        ) : r.openToday.length === 0 ? (
                            <Text style={styles.muted}>{s.noneOpen}</Text>
                        ) : null}
                        {r.error !== null ? <Notice tone="danger">{r.error}</Notice> : null}
                    </Panel>
                </>
            )}
        </ScrollView>
    );
}

function OpenVisits({
    visits,
    r,
}: {
    visits: ScheduleEvent[];
    r: ReturnType<typeof useReminderSettings>;
}) {
    const zone = useBusinessZone();
    return (
        <>
            {visits.map((v) => (
                <View key={v.id} style={styles.visit}>
                    <Text style={styles.value} numberOfLines={1}>
                        {v.headline}
                    </Text>
                    <Text style={styles.muted} numberOfLines={1}>
                        {formatParts([
                            v.serviceName,
                            formatWeekdayTime(v.start, zone),
                            v.staffShort,
                        ])}
                    </Text>
                    <View style={styles.rowGap}>
                        <Button
                            style={{ alignSelf: "center" }}
                            size="sm"
                            grow
                            variant="outline"
                            disabled={r.closing === v.id}
                            onPress={() => {
                                r.close(v, "no_show");
                            }}
                        >
                            {s.noShow}
                        </Button>
                        <Button
                            style={{ alignSelf: "center" }}
                            size="sm"
                            grow
                            busy={r.closing === v.id}
                            onPress={() => {
                                r.close(v, "completed");
                            }}
                        >
                            {s.complete}
                        </Button>
                    </View>
                </View>
            ))}
        </>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    body: { padding: 16, paddingBottom: 32, gap: 14 },
    card: { gap: 8 },
    muted: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 13 },
    soft: { color: c.inkSoft, fontFamily: theme.fonts.ui, fontSize: 14, lineHeight: 20 },
    value: { color: c.ink, fontFamily: theme.fonts.ui, fontSize: 14, fontWeight: "600" },
    rowGap: { flexDirection: "row", alignItems: "center", gap: 12 },
    email: {
        borderWidth: theme.borderWidth,
        borderColor: c.border,
        borderRadius: theme.radius,
        padding: 12,
        gap: 6,
    },
    visit: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.border,
        paddingTop: 10,
        gap: 4,
    },
});
