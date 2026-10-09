import {
    type ComposerSlot,
    addDays,
    eventFlags,
    eventLabelFor,
    formatHour,
    formatMoney,
    formatTime,
    hourMarks,
    minuteTop,
    offHourSpans,
    placeEvents,
    strings,
    useBookingActions,
    useBookingDetail,
    useBookingStart,
    useScheduleBoard,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Avatar,
    Button,
    CalendarEventCard,
    DateStrip,
    DetailView,
    Modal,
    Empty,
    Icon,
    IconButton,
    LoadFailed,
    Skeleton,
} from "@clientbridge/ui";
import { type RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
    BookingActionBar,
    BookingBody,
    BookingComposerSheet,
    RescheduleSheet,
} from "../components/BookingSheet";
import { api } from "../lib/api";
import { useViewer } from "../lib/auth";
import type { RootStackParamList, TabParamList } from "../navigation";

const c = theme.colors;
const s = strings.bookings;
const HOUR = 64;
const PX = HOUR / 60;
const GUTTER = 44;

export function ScheduleScreen() {
    const viewer = useViewer();
    const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
    const route = useRoute<RouteProp<TabParamList, "Schedule">>();
    const board = useScheduleBoard(viewer);
    const day = board.focus;
    const { startHour, endHour } = board.window;
    const detail = useBookingDetail(board.selected, board.now);
    const actions = useBookingActions(api, detail?.event ?? null, board.now);
    const [composer, setComposer] = useState<ComposerSlot | null>(null);
    const [moving, setMoving] = useState(false);
    const hours = hourMarks(startHour, endHour);
    const waiting = board.load.state === "loading" || board.load.state === "error";
    const openNew = (): void => {
        const first = day.lanes.find((l) => l.hours) ?? day.lanes[0];
        setComposer({
            staffId: first?.id ?? viewer?.staffId ?? "",
            start: new Date(day.date.getFullYear(), day.date.getMonth(), day.date.getDate(), 10),
        });
    };
    const create = route.params?.create;
    const open = route.params?.open ?? null;
    const openStart = useBookingStart(open);
    const { setAnchor, select } = board;
    useEffect(() => {
        if (create !== undefined) openNew();
    }, [create]);
    useEffect(() => {
        if (open === null || openStart === null) return;
        setAnchor(openStart);
        select(open);
    }, [open, openStart, setAnchor, select]);

    return (
        <SafeAreaView edges={["top"]} style={styles.screen}>
            <View style={styles.head}>
                <View style={styles.flex}>
                    <Text style={styles.title} accessibilityRole="header">
                        {s.title}
                    </Text>
                    <Text style={styles.subtitle} numberOfLines={1}>
                        {board.label}
                    </Text>
                </View>
                <IconButton
                    icon="users"
                    label={s.viewClasses}
                    onPress={() => {
                        nav.navigate("Classes");
                    }}
                />
                <IconButton
                    icon="repeat"
                    label={s.viewSeries}
                    onPress={() => {
                        nav.navigate("Recurrences");
                    }}
                />
                <Button style={{ alignSelf: "center" }} size="sm" icon="plus" onPress={openNew}>
                    {s.newShort}
                </Button>
            </View>
            <View style={styles.strip}>
                <DateStrip
                    label={s.railJump}
                    days={board.week}
                    value={day.key}
                    onChange={(key) => {
                        const hit = board.week.find((d) => d.key === key);
                        if (hit) board.setAnchor(hit.date);
                    }}
                    onPrev={() => {
                        board.setAnchor(addDays(board.anchor, -7));
                    }}
                    onNext={() => {
                        board.setAnchor(addDays(board.anchor, 7));
                    }}
                    prevLabel={s.prev}
                    nextLabel={s.next}
                />
            </View>
            <Text style={styles.summary} numberOfLines={1}>
                {waiting
                    ? s.loading
                    : [
                          s.bookings(board.summary.visits, board.summary.classes),
                          `${formatMoney(board.summary.expectedCents)} ${s.expected.toLowerCase()}`,
                          s.utilization(board.summary.utilization),
                      ].join("  ·  ")}
            </Text>

            <View style={styles.lanesHead}>
                <View style={{ width: GUTTER }} />
                {day.lanes.map((l) => (
                    <View key={l.id} style={styles.laneHead}>
                        <Avatar name={l.name} size="sm" color={l.color} />
                        <View style={styles.flex}>
                            <Text style={styles.laneName} numberOfLines={1}>
                                {l.short}
                            </Text>
                            <Text style={styles.laneSub} numberOfLines={1}>
                                {!l.hours && !l.unset ? s.off : s.bookings(l.events.length, 0)}
                            </Text>
                        </View>
                    </View>
                ))}
            </View>

            {board.load.state === "loading" ? (
                <View style={styles.pad}>
                    <Skeleton variant="row" count={6} label={s.loading} />
                </View>
            ) : board.load.state === "error" ? (
                <View style={styles.pad}>
                    <LoadFailed
                        message={s.loadError}
                        onRetry={board.load.retry}
                        retrying={board.load.retrying}
                    />
                </View>
            ) : day.closure ? (
                <View style={styles.closed}>
                    <Icon name="lock" size={22} color={c.muted} />
                    <Text style={styles.closedTitle}>{s.closed(day.closure.label)}</Text>
                    <Text style={styles.laneSub}>{s.emptyClosed}</Text>
                </View>
            ) : (
                <ScrollView contentContainerStyle={styles.gridWrap}>
                    {day.events.length === 0 ? (
                        <View style={styles.emptyBox}>
                            {day.lanes.some((l) => l.hours !== null || l.unset) ? (
                                <Empty
                                    variant="card"
                                    icon="calendar"
                                    message={s.emptyDayTitle}
                                    body={s.emptyDay}
                                    actions={
                                        <Button size="sm" onPress={openNew}>
                                            {s.newBooking}
                                        </Button>
                                    }
                                />
                            ) : (
                                <Empty
                                    variant="card"
                                    icon="moon"
                                    message={s.nobodyWorking}
                                    body={s.nobodyWorkingHint}
                                />
                            )}
                        </View>
                    ) : null}
                    <View style={[styles.grid, { height: (endHour - startHour) * HOUR }]}>
                        <View style={{ width: GUTTER }}>
                            {hours.map((h, i) => (
                                <Text key={h} style={[styles.hour, { top: i * HOUR - 7 }]}>
                                    {i === 0 ? "" : formatHour(h)}
                                </Text>
                            ))}
                        </View>
                        {day.lanes.map((lane) => (
                            <View key={lane.id} style={styles.lane}>
                                {offHourSpans(lane, startHour, endHour).map((sp) => (
                                    <View
                                        key={sp.from}
                                        style={[
                                            styles.off,
                                            { top: sp.from * PX, height: (sp.to - sp.from) * PX },
                                        ]}
                                    />
                                ))}
                                {hours.map((h, i) => (
                                    <View key={h} style={[styles.line, { top: i * HOUR }]} />
                                ))}
                                {lane.blocks.map((b) => (
                                    <View
                                        key={b.id}
                                        style={[
                                            styles.block,
                                            {
                                                top: Math.max(0, minuteTop(b.start, startHour, PX)),
                                                height: Math.max(
                                                    20,
                                                    ((b.end.getTime() - b.start.getTime()) /
                                                        60000) *
                                                        PX -
                                                        2,
                                                ),
                                            },
                                        ]}
                                    >
                                        <Icon
                                            name={b.kind === "break" ? "clock" : "moon"}
                                            size={11}
                                            color={c.muted}
                                        />
                                        <Text style={styles.blockText} numberOfLines={1}>
                                            {b.label}
                                        </Text>
                                    </View>
                                ))}
                                {placeEvents(lane.events, day.date, startHour, PX).map((p) => (
                                    <View
                                        key={p.event.id}
                                        style={[
                                            styles.event,
                                            {
                                                top: p.top,
                                                height: p.height,
                                                left: `${p.leftPct}%`,
                                                width: `${p.widthPct}%`,
                                            },
                                        ]}
                                    >
                                        <CalendarEventCard
                                            headline={p.event.petName ?? p.event.headline}
                                            detail={
                                                p.event.kind === "class"
                                                    ? s.classSeats(
                                                          p.event.bookedCount,
                                                          p.event.capacity,
                                                      )
                                                    : p.event.serviceName
                                            }
                                            time={formatTime(p.event.start)}
                                            intent={p.event.intent}
                                            color={p.event.color}
                                            density={
                                                p.height < 30
                                                    ? "compact"
                                                    : p.height < 58
                                                      ? "regular"
                                                      : "full"
                                            }
                                            flags={eventFlags(p.event).slice(0, 2)}
                                            state={
                                                board.selectedId === p.event.id
                                                    ? "selected"
                                                    : "idle"
                                            }
                                            label={eventLabelFor(p.event)}
                                            onPress={() => {
                                                board.select(p.event.id);
                                            }}
                                        />
                                    </View>
                                ))}
                            </View>
                        ))}
                        {day.isToday ? (
                            <View
                                pointerEvents="none"
                                style={[
                                    styles.now,
                                    { top: minuteTop(board.now, startHour, PX), left: GUTTER - 4 },
                                ]}
                            >
                                <View style={styles.nowDot} />
                                <View style={styles.nowLine} />
                            </View>
                        ) : null}
                    </View>
                </ScrollView>
            )}

            <Modal
                flow
                framed={false}
                size="xl"
                open={detail !== null}
                onClose={() => {
                    if (moving) setMoving(false);
                    else board.select(null);
                }}
            >
                {detail ? (
                    <DetailView
                        open={!moving}
                        title={detail.event.headline}
                        subtitle={detail.event.serviceName}
                        onClose={() => {
                            board.select(null);
                        }}
                        actions={
                            <BookingActionBar
                                actions={actions}
                                onReschedule={() => {
                                    setMoving(true);
                                }}
                            />
                        }
                    >
                        <BookingBody detail={detail} />
                    </DetailView>
                ) : null}
                {moving && detail ? (
                    <RescheduleSheet
                        event={detail.event}
                        onClose={() => {
                            setMoving(false);
                        }}
                    />
                ) : null}
            </Modal>
            {composer ? (
                <BookingComposerSheet
                    slot={composer}
                    board={board}
                    onClose={() => {
                        setComposer(null);
                    }}
                />
            ) : null}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.surface },
    flex: { flex: 1, minWidth: 0 },
    pad: { padding: 16 },
    head: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 16,
        paddingTop: 8,
    },
    title: { color: c.ink, fontSize: 26, fontWeight: "700" },
    subtitle: { color: c.muted, fontSize: 13, marginTop: 1 },
    strip: { paddingHorizontal: 8, paddingTop: 10 },
    summary: {
        color: c.muted,
        fontSize: 12,
        paddingHorizontal: 16,
        paddingTop: 6,
        paddingBottom: 8,
    },
    lanesHead: {
        flexDirection: "row",
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
    },
    laneHead: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 6,
        paddingVertical: 8,
        borderLeftWidth: 1,
        borderLeftColor: c.border,
    },
    laneName: { color: c.ink, fontSize: 13, fontWeight: "700" },
    laneSub: { color: c.muted, fontSize: 11 },
    gridWrap: { paddingBottom: 24, paddingTop: 8 },
    grid: { flexDirection: "row" },
    hour: { position: "absolute", right: 6, fontSize: 10, color: c.muted },
    lane: { flex: 1, borderLeftWidth: 1, borderLeftColor: c.border },
    off: { position: "absolute", left: 0, right: 0, backgroundColor: c.bg },
    line: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: c.borderSoft },
    block: {
        position: "absolute",
        left: 3,
        right: 3,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 3,
        padding: 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: c.border,
        borderStyle: "dashed",
        backgroundColor: c.bg,
    },
    blockText: { flex: 1, fontSize: 10, color: c.muted, fontWeight: "600" },
    event: { position: "absolute", paddingHorizontal: 2, paddingBottom: 2 },
    now: {
        position: "absolute",
        right: 0,
        flexDirection: "row",
        alignItems: "center",
        marginTop: -4,
    },
    nowDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.danFg },
    nowLine: { flex: 1, height: 2, backgroundColor: c.danFg },
    closed: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        backgroundColor: c.bg,
    },
    closedTitle: { color: c.ink, fontSize: 15, fontWeight: "700" },
    emptyBox: { marginHorizontal: 16, marginVertical: 8 },
});
