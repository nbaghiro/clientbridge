import {
    type ScheduleBoard,
    type ScheduleEvent,
    eventFlags,
    eventLabelFor,
    formatParts,
    formatTime,
    needsClosing,
    strings,
    upNext,
    useBookingActions,
    useBusinessZone,
    usePeoplePhotos,
    openRecord,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Avatar,
    Badge,
    Button,
    CalendarEventCard,
    DateStrip,
    ListRow,
    Meter,
    Skeleton,
} from "@clientbridge/ui";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "../lib/api";

const c = theme.colors;
const s = strings.bookings;

function Heading({ children, count }: { children: string; count?: number }) {
    return (
        <View style={styles.heading}>
            <Text style={styles.headingText} accessibilityRole="header">
                {children}
            </Text>
            {count !== undefined && count > 0 ? <Badge label={count} variant="count" /> : null}
        </View>
    );
}

function QuickClose({
    event,
    now,
    onOpen,
}: {
    event: ScheduleEvent;
    now: Date;
    onOpen: (e: ScheduleEvent) => void;
}) {
    const actions = useBookingActions(api, event, now);
    return (
        <View style={styles.quick}>
            <View style={styles.quickCard}>
                <CalendarEventCard
                    headline={event.headline}
                    detail={formatParts([event.serviceName, event.staffShort])}
                    time={event.timeLabel}
                    intent={event.intent}
                    color={event.color}
                    flags={eventFlags(event)}
                    label={eventLabelFor(event)}
                    onPress={() => {
                        onOpen(event);
                    }}
                />
            </View>
            {actions.canComplete ? (
                <View style={styles.quickActions}>
                    <Button
                        size="sm"
                        grow
                        busy={actions.pending === "complete"}
                        onPress={() => {
                            actions.run("complete");
                        }}
                    >
                        {s.complete}
                    </Button>
                    <Button
                        size="sm"
                        grow
                        variant="outline"
                        onPress={() => {
                            onOpen(event);
                        }}
                    >
                        {s.noShow}
                    </Button>
                </View>
            ) : null}
        </View>
    );
}

/** The calendar's right column on a tablet, as on the web: the week, what's on now, what to close, the team. */
export function ScheduleRail({ board }: { board: ScheduleBoard }) {
    const photos = usePeoplePhotos();
    const zone = useBusinessZone();
    const day = board.focus;
    const inProgress = day.events.filter((e) => e.inProgress);
    const toClose = needsClosing(day.events);
    const next = day.isToday ? upNext(day.events, board.now, 4) : day.events.slice(0, 8);
    const open = (e: ScheduleEvent): void => {
        openRecord("booking", e.id);
    };
    return (
        <ScrollView style={styles.rail} contentContainerStyle={styles.body}>
            <View style={styles.section}>
                <Heading>{s.railJump}</Heading>
                <DateStrip
                    label={s.railJump}
                    days={board.week}
                    value={day.key}
                    onChange={(key) => {
                        const hit = board.week.find((d) => d.key === key);
                        if (hit) board.setAnchor(hit.date);
                    }}
                />
            </View>
            {board.load.state === "loading" ? (
                <Skeleton variant="line" count={5} label={s.loading} />
            ) : board.load.state === "error" ? null : (
                <>
                    {inProgress.length > 0 ? (
                        <View style={styles.section}>
                            <Heading count={inProgress.length}>{s.railInProgress}</Heading>
                            {inProgress.map((e) => (
                                <QuickClose key={e.id} event={e} now={board.now} onOpen={open} />
                            ))}
                        </View>
                    ) : null}
                    {toClose.length > 0 ? (
                        <View style={styles.section}>
                            <Heading count={toClose.length}>{s.railToClose}</Heading>
                            {toClose.map((e) => (
                                <QuickClose key={e.id} event={e} now={board.now} onOpen={open} />
                            ))}
                        </View>
                    ) : null}
                    <View style={styles.section}>
                        <Heading count={next.length}>
                            {day.isToday ? s.railUpNext : s.dayVisits}
                        </Heading>
                        {next.length === 0 ? (
                            <Text style={styles.muted}>
                                {day.isToday ? s.railNothingNext : s.noBookings}
                            </Text>
                        ) : (
                            next.map((e) => (
                                <ListRow
                                    key={e.id}
                                    density="compact"
                                    leading={
                                        <View style={styles.time}>
                                            <Text style={styles.clock}>
                                                {formatTime(e.start, zone)}
                                            </Text>
                                            <View
                                                style={[
                                                    styles.bar,
                                                    { backgroundColor: e.color ?? c.accent },
                                                ]}
                                            />
                                        </View>
                                    }
                                    title={e.headline}
                                    detail={formatParts([e.serviceName, e.staffShort])}
                                    onPress={() => {
                                        open(e);
                                    }}
                                />
                            ))
                        )}
                    </View>
                    <View style={styles.section}>
                        <Heading>{day.isToday ? s.railTeam : s.groupTeam}</Heading>
                        {day.lanes.map((l) => (
                            <View key={l.id} style={styles.member}>
                                <Avatar
                                    name={l.name}
                                    src={photos.staff(l.id)}
                                    size="sm"
                                    color={l.color}
                                />
                                <View style={styles.flex}>
                                    <Meter
                                        value={Math.round(l.utilization * 100)}
                                        max={100}
                                        label={l.name}
                                        detail={
                                            l.hours
                                                ? s.utilization(Math.round(l.utilization * 100))
                                                : s.off
                                        }
                                        size="sm"
                                    />
                                    <Text style={styles.muted}>{l.hoursLabel}</Text>
                                </View>
                            </View>
                        ))}
                    </View>
                </>
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    rail: {
        width: 320,
        flexGrow: 0,
        borderLeftWidth: StyleSheet.hairlineWidth,
        borderLeftColor: c.border,
    },
    body: { padding: 16, gap: 22 },
    section: { gap: 8 },
    heading: { flexDirection: "row", alignItems: "center", gap: 8 },
    headingText: {
        color: c.muted,
        fontFamily: theme.fonts.ui,
        fontSize: 11,
        fontWeight: "600",
        letterSpacing: 0.6,
        textTransform: "uppercase",
    },
    quick: {
        gap: 8,
        padding: 8,
        borderRadius: theme.radius,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
    },
    quickCard: { height: 56 },
    quickActions: { flexDirection: "row", gap: 8 },
    time: { flexDirection: "row", alignItems: "center", gap: 10 },
    clock: {
        width: 64,
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: 13,
        fontWeight: "600",
    },
    bar: { width: 3, height: 30, borderRadius: 2 },
    member: { flexDirection: "row", alignItems: "center", gap: 10 },
    flex: { flex: 1, minWidth: 0 },
    muted: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 12, marginTop: 2 },
});
