import {
    type ScheduleEvent,
    formatTime,
    formatWeekday,
    strings,
    useReminderSettings,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Button,
    Checkbox,
    Choice,
    LoadFailed,
    MessageBubble,
    Notice,
    Skeleton,
    Stat,
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
                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>{s.remindersTitle}</Text>
                        <Text style={styles.muted}>{s.remindersHint}</Text>
                        <Text style={styles.value}>{s.ruleLead}</Text>
                        <View style={styles.rowGap}>
                            <Checkbox label={s.channelSms} value disabled />
                            <Checkbox label={s.channelEmail} value disabled />
                        </View>
                        <Text style={styles.muted}>{s.channelsHint}</Text>
                        <Notice tone="info" banner>
                            {s.rulesFixed}
                        </Notice>
                        <Text style={styles.value}>{s.includeLink}</Text>
                        <Text style={styles.muted}>{s.includeLinkHint}</Text>
                    </View>
                    <View style={styles.card}>
                        <View style={styles.headRow}>
                            <Text style={styles.cardTitle}>{s.preview}</Text>
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
                        </View>
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
                    </View>
                    <View style={styles.card}>
                        <Stat
                            label={`${s.deliveryTitle} · ${s.sent}`}
                            value={s.sentCount(r.sentWeek)}
                        />
                    </View>
                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>{s.endOfDayTitle}</Text>
                        <Text style={styles.muted}>{s.endOfDayHint}</Text>
                        <Notice tone="info" banner>
                            {s.autoCloseLater}
                        </Notice>
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
                    </View>
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
    return (
        <>
            {visits.map((v) => (
                <View key={v.id} style={styles.visit}>
                    <Text style={styles.value} numberOfLines={1}>
                        {v.headline}
                    </Text>
                    <Text style={styles.muted} numberOfLines={1}>
                        {`${v.serviceName} · ${formatWeekday(v.start)} ${formatTime(v.start)} · ${v.staffShort}`}
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
    screen: { flex: 1, backgroundColor: c.bg },
    body: { padding: 16, paddingBottom: 32, gap: 14 },
    card: {
        backgroundColor: c.surface,
        borderRadius: theme.radius,
        borderWidth: 1,
        borderColor: c.border,
        padding: 16,
        gap: 8,
    },
    cardTitle: { color: c.ink, fontSize: 16, fontWeight: "700" },
    headRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
    muted: { color: c.muted, fontSize: 13 },
    soft: { color: c.inkSoft, fontSize: 14, lineHeight: 20 },
    value: { color: c.ink, fontSize: 14, fontWeight: "600" },
    rowGap: { flexDirection: "row", alignItems: "center", gap: 12 },
    email: {
        borderWidth: 1,
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
