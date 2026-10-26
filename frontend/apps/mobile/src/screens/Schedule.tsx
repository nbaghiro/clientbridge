import {
    type BookingDraft,
    type ComposerSlot,
    addDays,
    dateKey,
    draftWindow,
    suggestedStart,
    arrivalLabel,
    blockSpan,
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
    useBookingComposer,
    useBookingDetail,
    useBookingStart,
    usePeoplePhotos,
    useScheduleBoard,
    formatParts,
    BUSINESS_CURRENCY,
    useBusinessZone,
    minutesInto,
    useSubjectKind,
    useCrewJob,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Avatar,
    Backdrop,
    Button,
    CalendarEventCard,
    DateStrip,
    DetailView,
    Empty,
    Icon,
    IconButton,
    PageHeader,
    SheetHeader,
    KeyValueList,
    LoadFailed,
    Modal,
    Notice,
    Select,
    Skeleton,
} from "@clientbridge/ui";
import { type RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useRef, useState } from "react";
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
    const photos = usePeoplePhotos();
    const zone = useBusinessZone();
    const kind = useSubjectKind();
    const viewer = useViewer();
    const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
    const route = useRoute<RouteProp<TabParamList, "Schedule">>();
    const board = useScheduleBoard(viewer);
    const day = board.focus;
    const detail = useBookingDetail(board.selected, board.now);
    const actions = useBookingActions(api, detail?.event ?? null, board.now);
    const [composer, setComposer] = useState<ComposerSlot | null>(null);
    const [expanded, setExpanded] = useState(true);
    const [dragging, setDragging] = useState(false);
    const [lanesWidth, setLanesWidth] = useState(0);
    const scroll = useRef<ScrollView>(null);
    const form = useBookingComposer(api, composer, board, () => {
        setComposer(null);
    });
    const draft = form.draft;
    const draftLane = draft === null ? -1 : day.lanes.findIndex((l) => l.id === draft.staffId);
    const showDraft = draft !== null && draftLane >= 0 && dateKey(draft.start, zone) === day.key;
    const { startHour, endHour } = draftWindow(
        board.window,
        showDraft ? draft : null,
        day.date,
        zone,
    );
    const draftTop = draft === null ? 0 : minuteTop(draft.start, startHour, PX, zone);
    const [moving, setMoving] = useState(false);
    const hours = hourMarks(startHour, endHour);
    const waiting = board.load.state === "loading" || board.load.state === "error";
    const openNew = (
        from: { estimateId?: string | undefined; rebookId?: string | undefined } = {},
    ): void => {
        const first = day.lanes.find((l) => l.hours) ?? day.lanes[0];
        setExpanded(true);
        setComposer({
            staffId: first?.id ?? viewer?.staffId ?? "",
            start: suggestedStart(day.date, board.now, board.window, zone),
            ...from,
        });
    };
    const tapLane = (staffId: string, y: number): void => {
        const at = minutesInto(day.date, startHour * 60 + Math.floor(y / PX / 15) * 15, zone);
        if (composer) {
            form.place(staffId, at);
            return;
        }
        board.select(null);
        setExpanded(true);
        setComposer({ staffId, start: at });
    };
    const showCalendar = (): void => {
        setExpanded(false);
        scroll.current?.scrollTo({ y: Math.max(0, draftTop - 96), animated: true });
    };
    const create = route.params?.create;
    const estimate = route.params?.estimate;
    const rebook = route.params?.rebook;
    const open = route.params?.open ?? null;
    const openStart = useBookingStart(open);
    const { setAnchor, select } = board;
    useEffect(() => {
        if (create !== undefined) openNew({ estimateId: estimate, rebookId: rebook });
    }, [create]);
    useEffect(() => {
        if (open === null || openStart === null) return;
        setAnchor(openStart);
        select(open);
    }, [open, openStart, setAnchor, select]);

    return (
        <SafeAreaView edges={["top"]} style={styles.screen}>
            <Backdrop />
            <PageHeader
                style={styles.head}
                title={s.title}
                subtitle={board.label}
                actions={
                    <>
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
                        <Button
                            style={{ alignSelf: "center" }}
                            size="sm"
                            icon="plus"
                            onPress={() => {
                                openNew();
                            }}
                        >
                            {s.newShort}
                        </Button>
                    </>
                }
            />
            {board.resourceOptions !== null ? (
                <View style={styles.strip}>
                    <Select
                        name={s.resourceFilter}
                        size="sm"
                        value={board.resource}
                        options={board.resourceOptions}
                        onChange={board.setResource}
                    />
                </View>
            ) : null}
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
                        board.setAnchor(addDays(board.anchor, -7, zone));
                    }}
                    onNext={() => {
                        board.setAnchor(addDays(board.anchor, 7, zone));
                    }}
                    prevLabel={s.prev}
                    nextLabel={s.next}
                />
            </View>
            <Text style={styles.summary} numberOfLines={1}>
                {waiting
                    ? s.loading
                    : formatParts([
                          s.bookings(board.summary.visits, board.summary.classes),
                          s.expectedAmount(
                              formatMoney(board.summary.expectedCents, BUSINESS_CURRENCY),
                          ),
                          s.utilization(board.summary.utilization),
                      ])}
            </Text>

            <View style={styles.lanesHead}>
                <View style={{ width: GUTTER }} />
                {day.lanes.map((l) => (
                    <View key={l.id} style={styles.laneHead}>
                        <Avatar name={l.name} src={photos.staff(l.id)} size="sm" color={l.color} />
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
                        message={
                            board.historyUnavailable ? strings.sync.historyUnavailable : s.loadError
                        }
                        onRetry={board.load.retry}
                        retrying={board.load.retrying}
                    />
                </View>
            ) : (
                <ScrollView
                    ref={scroll}
                    scrollEnabled={!dragging}
                    contentContainerStyle={[
                        styles.gridWrap,
                        composer ? { paddingBottom: expanded ? 560 : 200 } : null,
                    ]}
                >
                    {day.closedNote !== null ? (
                        <Notice tone="info" banner style={styles.closedNote}>
                            {day.closedNote}
                        </Notice>
                    ) : day.events.length === 0 && !showDraft ? (
                        <View style={styles.emptyBox}>
                            {day.lanes.some((l) => l.hours !== null || l.unset) ? (
                                <Empty
                                    variant="card"
                                    icon="calendar"
                                    message={s.emptyDayTitle}
                                    body={s.emptyDay}
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
                        <View
                            style={styles.lanes}
                            onLayout={(e) => {
                                setLanesWidth(e.nativeEvent.layout.width);
                            }}
                        >
                            {day.lanes.map((lane) => (
                                <View key={lane.id} style={styles.lane}>
                                    <Pressable
                                        style={StyleSheet.absoluteFill}
                                        accessibilityLabel={formatParts([s.newBooking, lane.short])}
                                        onPress={(e) => {
                                            tapLane(lane.id, e.nativeEvent.locationY);
                                        }}
                                    />
                                    {offHourSpans(lane, startHour, endHour, zone).map((sp) => (
                                        <View
                                            key={sp.from}
                                            pointerEvents="none"
                                            style={[
                                                styles.off,
                                                {
                                                    top: sp.from * PX,
                                                    height: (sp.to - sp.from) * PX,
                                                },
                                            ]}
                                        />
                                    ))}
                                    {hours.map((h, i) => (
                                        <View
                                            key={h}
                                            pointerEvents="none"
                                            style={[styles.line, { top: i * HOUR }]}
                                        />
                                    ))}
                                    {lane.blocks.map((b) => {
                                        const span = blockSpan(
                                            b,
                                            day.date,
                                            startHour,
                                            endHour,
                                            PX,
                                            zone,
                                        );
                                        const job = b.kind === "job" ? (b.bookingId ?? null) : null;
                                        return span === null ? null : (
                                            <View
                                                key={b.id}
                                                pointerEvents={job !== null ? "box-none" : "none"}
                                                style={[
                                                    styles.block,
                                                    {
                                                        top: span.top,
                                                        height: Math.max(20, span.height - 2),
                                                    },
                                                ]}
                                            >
                                                <Icon
                                                    name={
                                                        job !== null
                                                            ? "users"
                                                            : b.kind === "break"
                                                              ? "clock"
                                                              : "moon"
                                                    }
                                                    size={11}
                                                    color={c.muted}
                                                />
                                                <Text style={styles.blockText} numberOfLines={1}>
                                                    {b.label}
                                                </Text>
                                                {job !== null ? (
                                                    <JobDetails bookingId={job} />
                                                ) : null}
                                            </View>
                                        );
                                    })}
                                    {placeEvents(lane.events, day.date, startHour, PX, zone).map(
                                        (p) => (
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
                                                    headline={
                                                        p.event.subjectName ?? p.event.headline
                                                    }
                                                    detail={
                                                        p.event.kind === "class"
                                                            ? s.classSeats(
                                                                  p.event.bookedCount,
                                                                  p.event.capacity,
                                                              )
                                                            : formatParts([
                                                                  p.event.serviceName,
                                                                  arrivalLabel(p.event, kind),
                                                              ])
                                                    }
                                                    time={formatTime(p.event.start, zone)}
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
                                        ),
                                    )}
                                </View>
                            ))}
                            {showDraft ? (
                                <DraftCard
                                    draft={draft}
                                    lane={draftLane}
                                    lanes={day.lanes.length}
                                    top={draftTop}
                                    height={((+draft.end - +draft.start) / 60_000) * PX}
                                    laneWidth={lanesWidth / Math.max(1, day.lanes.length)}
                                    onPlace={(lane, start) => {
                                        const id = day.lanes[lane]?.id;
                                        if (id !== undefined) form.place(id, start);
                                    }}
                                    onDragging={setDragging}
                                />
                            ) : null}
                        </View>
                        {day.isToday ? (
                            <View
                                pointerEvents="none"
                                style={[
                                    styles.now,
                                    {
                                        top: minuteTop(board.now, startHour, PX, zone),
                                        left: GUTTER - 4,
                                    },
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
                    form={form}
                    expanded={expanded}
                    onExpand={() => {
                        setExpanded(true);
                    }}
                    onCollapse={showCalendar}
                    onClose={() => {
                        setComposer(null);
                    }}
                />
            ) : null}
        </SafeAreaView>
    );
}

/** The visit being booked, drawn where it would land; drag it to another member or time. */
function DraftCard({
    draft,
    lane,
    lanes,
    top,
    height,
    laneWidth,
    onPlace,
    onDragging,
}: {
    draft: BookingDraft;
    lane: number;
    lanes: number;
    top: number;
    height: number;
    laneWidth: number;
    onPlace: (lane: number, start: Date) => void;
    onDragging: (on: boolean) => void;
}) {
    const latest = useRef({ draft, lane, lanes, laneWidth, onPlace, onDragging });
    latest.current = { draft, lane, lanes, laneWidth, onPlace, onDragging };
    const origin = useRef<{ lane: number; start: Date; last: string } | null>(null);
    const end = (): void => {
        origin.current = null;
        latest.current.onDragging(false);
    };
    const pan = useRef(
        PanResponder.create({
            onStartShouldSetPanResponderCapture: () => true,
            onPanResponderTerminationRequest: () => false,
            onPanResponderGrant: () => {
                const l = latest.current;
                origin.current = { lane: l.lane, start: l.draft.start, last: "0|0" };
                l.onDragging(true);
            },
            onPanResponderMove: (_e, g) => {
                const o = origin.current;
                const l = latest.current;
                if (o === null) return;
                const shift = l.laneWidth === 0 ? 0 : Math.round(g.dx / l.laneWidth);
                const target = Math.max(0, Math.min(l.lanes - 1, o.lane + shift));
                const minutes = Math.round(g.dy / PX / 15) * 15;
                const key = `${String(target)}|${String(minutes)}`;
                if (key === o.last) return;
                o.last = key;
                l.onPlace(target, new Date(+o.start + minutes * 60_000));
            },
            onPanResponderRelease: end,
            onPanResponderTerminate: end,
        }),
    ).current;
    return (
        <View
            {...pan.panHandlers}
            testID="draft"
            style={[
                styles.draft,
                {
                    top,
                    height,
                    left: `${(lane * 100) / lanes}%`,
                    width: `${100 / lanes}%`,
                },
            ]}
        >
            <CalendarEventCard
                headline={draft.headline}
                detail={draft.detail}
                time={draft.startLabel}
                intent="accent"
                density={height < 30 ? "compact" : height < 58 ? "regular" : "full"}
                state={draft.problem === null ? "draft" : "refused"}
                label={draft.label}
            />
            {draft.problem !== null ? (
                <View pointerEvents="none" style={styles.draftProblem}>
                    <Text style={styles.draftProblemText} numberOfLines={1}>
                        {draft.problem}
                    </Text>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.surface },
    flex: { flex: 1, minWidth: 0 },
    pad: { padding: 16 },
    head: { paddingHorizontal: 16, paddingTop: 8 },
    strip: { paddingHorizontal: 8, paddingTop: 10 },
    summary: {
        color: c.muted,
        fontFamily: theme.fonts.ui,
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
    laneName: { color: c.ink, fontFamily: theme.fonts.ui, fontSize: 13, fontWeight: "700" },
    laneSub: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 11 },
    gridWrap: { paddingBottom: 24, paddingTop: 8 },
    grid: { flexDirection: "row" },
    hour: {
        position: "absolute",
        right: 6,
        fontFamily: theme.fonts.ui,
        fontSize: 10,
        color: c.muted,
    },
    lanes: { flex: 1, flexDirection: "row" },
    lane: { flex: 1, borderLeftWidth: 1, borderLeftColor: c.border },
    draft: { position: "absolute", zIndex: 5, paddingHorizontal: 2, paddingBottom: 2 },
    draftProblem: {
        position: "absolute",
        top: -24,
        left: 2,
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 3,
        backgroundColor: c.danFg,
    },
    draftProblemText: {
        color: c.surface,
        fontFamily: theme.fonts.ui,
        fontSize: 11,
        fontWeight: "700",
    },
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
        borderWidth: theme.borderWidth,
        borderColor: c.border,
        borderStyle: "dashed",
        backgroundColor: c.bg,
    },
    blockText: {
        flex: 1,
        fontFamily: theme.fonts.ui,
        fontSize: 10,
        color: c.muted,
        fontWeight: "600",
    },
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
    closedNote: { marginHorizontal: 16, marginTop: 0, marginBottom: 8 },
    emptyBox: { marginHorizontal: 16, marginVertical: 8 },
});

function JobDetails({ bookingId }: { bookingId: string }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <IconButton
                icon="eye"
                label={strings.bookings.crewJob}
                size="sm"
                onPress={() => {
                    setOpen(true);
                }}
            />
            {open ? (
                <JobSheet
                    bookingId={bookingId}
                    onClose={() => {
                        setOpen(false);
                    }}
                />
            ) : null}
        </>
    );
}

function JobSheet({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
    const { job, loading, error } = useCrewJob(api, bookingId);
    return (
        <Modal open onClose={onClose} size="sm">
            <View style={jobStyles.sheet}>
                <SheetHeader
                    title={job?.title ?? strings.bookings.crewJob}
                    onClose={onClose}
                    closeLabel={strings.common.close}
                />
                {loading ? <Text style={jobStyles.muted}>{strings.common.loading}</Text> : null}
                {error !== null ? <Notice tone="danger">{error}</Notice> : null}
                {job !== null ? (
                    <KeyValueList
                        layout="stack"
                        rows={job.facts.map((f) => ({ label: f.label, value: f.value }))}
                    />
                ) : null}
            </View>
        </Modal>
    );
}

const jobStyles = StyleSheet.create({
    sheet: { gap: 12, padding: 20 },
    muted: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 14 },
});
