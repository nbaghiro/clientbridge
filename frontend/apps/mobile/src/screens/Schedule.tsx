import {
    type CalendarEvent,
    calendarRange,
    canCollectDeposit,
    checkoutMethods,
    dateKey,
    dayBounds,
    depositStatusIntent,
    eventLabel,
    formatHour,
    formatMoney,
    formatMonthYear,
    formatTime,
    formatWeekday,
    groupByDay,
    layoutDay,
    minutesSinceMidnight,
    type PositionedEvent,
    rescheduleByDrag,
    sameDay,
    shiftAnchor,
    startOfDay,
    statusIntent,
    strings,
    useBookingAddons,
    useCalendarEvents,
    useCancelBooking,
    useCollectDeposit,
    useSavedCards,
    weekColumns,
} from "@clientbridge/app-core";
import { INTENT_COLORS } from "@clientbridge/tokens";
import { theme } from "@clientbridge/tokens/native";
import { useRef, useState } from "react";
import {
    Animated,
    PanResponder,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
    Button,
    ChargeSheet,
    DetailSection,
    DetailView,
    Empty,
    Money,
    Notice,
    StatusPill,
    Tabs,
    ui,
} from "@clientbridge/ui";

import { api } from "../lib/api";
import { useViewer } from "../lib/auth";

const c = theme.colors;
const HOUR_PX = 56;
const PX_PER_MIN = HOUR_PX / 60;
const GUTTER = 52;

type View2 = "agenda" | "day";

function statusColors(status: string): { bg: string; fg: string; border: string } {
    const tone = INTENT_COLORS[statusIntent(status)];
    return { bg: c[tone.soft], fg: c[tone.ink], border: c[tone.line] };
}

export function ScheduleScreen() {
    const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
    const [view, setView] = useState<View2>("agenda");
    const [detail, setDetail] = useState<CalendarEvent | null>(null);

    const week = weekColumns(anchor);
    const { start: rangeStart, end: rangeEnd } = calendarRange("week", anchor);
    const events = useCalendarEvents(rangeStart, rangeEnd);
    const now = new Date();

    const dayEvents = groupByDay(events).get(dateKey(anchor)) ?? [];

    return (
        <SafeAreaView edges={["top"]} style={styles.screen}>
            <View style={styles.header}>
                <Text style={styles.month}>{formatMonthYear(anchor)}</Text>
                <Tabs
                    pill
                    inset={false}
                    items={[
                        { key: "agenda", label: strings.bookings.viewAgenda },
                        { key: "day", label: strings.bookings.viewDay },
                    ]}
                    active={view}
                    onSelect={setView}
                />
            </View>

            <View style={styles.strip}>
                <Button
                    variant="quiet"
                    size="sm"
                    label={strings.bookings.prev}
                    onPress={() => {
                        setAnchor((a) => shiftAnchor("week", a, -1));
                    }}
                >
                    <Text style={styles.chev}>‹</Text>
                </Button>
                {week.map((day) => {
                    const selected = sameDay(day, anchor);
                    const today = sameDay(day, now);
                    return (
                        <Pressable
                            key={day.toISOString()}
                            onPress={() => {
                                setAnchor(day);
                            }}
                            style={[styles.pill, selected && styles.pillOn]}
                        >
                            <Text style={[styles.pillDow, selected && styles.pillTextOn]}>
                                {formatWeekday(day).slice(0, 3)}
                            </Text>
                            <Text
                                style={[
                                    styles.pillNum,
                                    selected && styles.pillTextOn,
                                    today && !selected && styles.pillToday,
                                ]}
                            >
                                {day.getDate()}
                            </Text>
                        </Pressable>
                    );
                })}
                <Button
                    variant="quiet"
                    size="sm"
                    label={strings.bookings.next}
                    onPress={() => {
                        setAnchor((a) => shiftAnchor("week", a, 1));
                    }}
                >
                    <Text style={styles.chev}>›</Text>
                </Button>
            </View>

            {view === "agenda" ? (
                <AgendaList events={dayEvents} onEventPress={setDetail} />
            ) : (
                <DayGrid anchor={anchor} events={events} now={now} onEventPress={setDetail} />
            )}
            {detail !== null ? (
                <EventDetailSheet
                    event={detail}
                    onClose={() => {
                        setDetail(null);
                    }}
                />
            ) : null}
        </SafeAreaView>
    );
}

function AgendaList({
    events,
    onEventPress,
}: {
    events: CalendarEvent[];
    onEventPress: (e: CalendarEvent) => void;
}) {
    if (events.length === 0) {
        return <Empty message={strings.bookings.noBookings} />;
    }
    return (
        <ScrollView contentContainerStyle={styles.agenda}>
            {events.map((e) => {
                const sc = statusColors(e.status);
                return (
                    <Pressable
                        key={e.id}
                        onPress={() => {
                            onEventPress(e);
                        }}
                        style={styles.agendaRow}
                    >
                        <Text style={styles.agendaTime}>{formatTime(e.start)}</Text>
                        <View style={[styles.dot, { backgroundColor: sc.border }]} />
                        <View style={styles.agendaBody}>
                            <Text style={styles.agendaTitle}>{eventLabel(e)}</Text>
                            <Text style={styles.agendaSub}>{e.title}</Text>
                        </View>
                    </Pressable>
                );
            })}
        </ScrollView>
    );
}

function DayGrid({
    anchor,
    events,
    now,
    onEventPress,
}: {
    anchor: Date;
    events: CalendarEvent[];
    now: Date;
    onEventPress: (e: CalendarEvent) => void;
}) {
    const { startHour, endHour } = dayBounds(events);
    const offsetPx = startHour * 60 * PX_PER_MIN;
    const gridHeight = (endHour - startHour) * HOUR_PX;
    const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
    const positioned = layoutDay(events, { dayStart: startOfDay(anchor), pxPerMin: PX_PER_MIN });
    const showNow = sameDay(anchor, now);
    const nowTop = minutesSinceMidnight(now) * PX_PER_MIN - offsetPx;

    const reschedule = (event: CalendarEvent, deltaY: number): void => {
        rescheduleByDrag(api, event, deltaY, PX_PER_MIN);
    };

    return (
        <ScrollView contentContainerStyle={{ flexDirection: "row", paddingBottom: 24 }}>
            <View style={{ width: GUTTER }}>
                {hours.map((h) => (
                    <View key={h} style={{ height: HOUR_PX }}>
                        <Text style={styles.hourLabel}>{formatHour(h)}</Text>
                    </View>
                ))}
            </View>
            <View style={{ flex: 1, height: gridHeight }}>
                {hours.map((h, i) => (
                    <View key={h} style={[styles.hourLine, { top: i * HOUR_PX }]} />
                ))}
                {positioned.map((pe) => (
                    <DraggableEvent
                        key={pe.event.id}
                        pe={pe}
                        offsetPx={offsetPx}
                        onTap={onEventPress}
                        onReschedule={reschedule}
                    />
                ))}
                {showNow && nowTop >= 0 && nowTop <= gridHeight ? (
                    <View style={[styles.nowLine, { top: nowTop }]} />
                ) : null}
            </View>
        </ScrollView>
    );
}

function DraggableEvent({
    pe,
    offsetPx,
    onTap,
    onReschedule,
}: {
    pe: PositionedEvent;
    offsetPx: number;
    onTap: (e: CalendarEvent) => void;
    onReschedule: (e: CalendarEvent, deltaY: number) => void;
}) {
    const { event, topPx, heightPx, leftPct, widthPct } = pe;
    const sc = statusColors(event.status);
    const pan = useRef(new Animated.Value(0)).current;
    const startedAt = useRef(0);
    const [dragging, setDragging] = useState(false);
    // Keep the latest props for the responder, which is created once.
    const latest = useRef({ event, onReschedule });
    latest.current = { event, onReschedule };
    const snapStep = 5 * PX_PER_MIN;

    const responder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => {
                startedAt.current = Date.now();
                return false;
            },
            // Grab only after a long-press (so a quick scroll stays with the ScrollView).
            onMoveShouldSetPanResponderCapture: (_e, g) =>
                latest.current.event.bookingId !== null &&
                Date.now() - startedAt.current > 250 &&
                Math.abs(g.dy) > 4,
            onPanResponderGrant: () => {
                setDragging(true);
            },
            onPanResponderMove: (_e, g) => {
                pan.setValue(Math.round(g.dy / snapStep) * snapStep);
            },
            onPanResponderRelease: (_e, g) => {
                setDragging(false);
                pan.setValue(0);
                latest.current.onReschedule(latest.current.event, g.dy);
            },
            onPanResponderTerminate: () => {
                setDragging(false);
                pan.setValue(0);
            },
        }),
    ).current;

    return (
        <Animated.View
            {...responder.panHandlers}
            style={{
                position: "absolute",
                top: topPx - offsetPx,
                height: heightPx,
                left: `${leftPct}%`,
                width: `${widthPct}%`,
                paddingHorizontal: 2,
                transform: [{ translateY: pan }],
                zIndex: dragging ? 10 : 1,
            }}
        >
            <Pressable
                onPress={() => {
                    onTap(event);
                }}
                style={[
                    styles.event,
                    { backgroundColor: sc.bg, borderLeftColor: sc.border },
                    dragging && styles.eventDragging,
                ]}
            >
                <Text style={[styles.eventTitle, { color: sc.fg }]} numberOfLines={1}>
                    {eventLabel(event)}
                </Text>
                {heightPx > 32 ? (
                    <Text style={[styles.eventSub, { color: sc.fg }]} numberOfLines={1}>
                        {formatTime(event.start)} · {event.title}
                    </Text>
                ) : null}
            </Pressable>
        </Animated.View>
    );
}

function EventDetailSheet({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
    const { busy, error, cancel } = useCancelBooking(api, event, onClose);
    return (
        <DetailView
            open
            title={event.title}
            subtitle={event.subtitle.length > 0 ? event.subtitle : undefined}
            status={{ status: event.status, intent: statusIntent(event.status) }}
            onClose={onClose}
            actions={
                event.bookingId !== null && event.status !== "canceled" ? (
                    <Button variant="danger" onPress={cancel} busy={busy}>
                        {busy ? strings.bookings.canceling : strings.bookings.cancelBooking}
                    </Button>
                ) : undefined
            }
        >
            <Text style={styles.detailTime}>
                {formatTime(event.start)} – {formatTime(event.end)}
            </Text>
            {event.depositRequired ? <DepositSection event={event} onClose={onClose} /> : null}
            {event.bookingId !== null ? <AddonsSection event={event} /> : null}
            {error !== null ? <Notice tone="danger">{error}</Notice> : null}
        </DetailView>
    );
}

function AddonsSection({ event }: { event: CalendarEvent }) {
    const addons = useBookingAddons(api, event, useViewer());
    if (addons.addons.length === 0) return null;

    return (
        <DetailSection title={strings.bookings.addonsTitle}>
            <Text style={ui.note}>{strings.bookings.addonsNote}</Text>
            {addons.addons.map((a) => (
                <View key={a.id} style={styles.addonRow}>
                    <Text style={styles.addonName} numberOfLines={1}>
                        {a.quantity} × {a.description}
                    </Text>
                    <Text style={styles.addonAmount}>
                        {formatMoney(a.quantity * a.unit_amount_cents)}
                    </Text>
                    {addons.canEdit ? (
                        <Button
                            variant="danger"
                            size="sm"
                            disabled={addons.busy}
                            onPress={() => {
                                addons.remove(a.id);
                            }}
                        >
                            {strings.bookings.addonRemove}
                        </Button>
                    ) : null}
                </View>
            ))}
            {addons.invoiceId !== null ? (
                <Text style={ui.note}>{strings.bookings.visitInvoiced}</Text>
            ) : null}
            {addons.canInvoice ? (
                <View style={styles.invoice}>
                    <Button variant="outline" disabled={addons.busy} onPress={addons.createInvoice}>
                        {strings.bookings.invoiceVisit}
                    </Button>
                </View>
            ) : null}
            {addons.error !== null ? <Notice tone="danger">{addons.error}</Notice> : null}
        </DetailSection>
    );
}

function DepositSection({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
    const viewer = useViewer();
    const cards = useSavedCards(event.clientId ?? "");
    const deposit = useCollectDeposit(api, event, onClose, cards.at(0)?.id);
    const amountLabel = formatMoney(event.depositAmountCents);

    return (
        <DetailSection
            title={strings.bookings.deposit}
            action={
                <StatusPill
                    status={event.depositStatus}
                    intent={depositStatusIntent(event.depositStatus)}
                />
            }
        >
            <Money cents={event.depositAmountCents} strong />
            {canCollectDeposit(event, viewer) ? (
                <ChargeSheet
                    checkout={deposit.checkout}
                    methods={checkoutMethods(cards)}
                    amountLabel={amountLabel}
                    submitLabel={strings.bookings.collectAmount(amountLabel)}
                    busyLabel={strings.bookings.collecting}
                    onSubmit={deposit.submit}
                    onCancel={onClose}
                />
            ) : null}
        </DetailSection>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    addonRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
    addonName: { flex: 1, color: c.ink, fontSize: 14 },
    addonAmount: { color: c.ink, fontSize: 14, fontVariant: ["tabular-nums"] },
    invoice: { marginTop: 10 },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    month: { color: c.ink, fontSize: 20, fontWeight: "700", letterSpacing: -0.3 },
    strip: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 12,
        paddingBottom: 10,
    },
    chev: { color: c.muted, fontSize: 24, paddingHorizontal: 4 },
    pill: { alignItems: "center", paddingVertical: 4, paddingHorizontal: 6, borderRadius: 10 },
    pillOn: { backgroundColor: c.accent },
    pillDow: { color: c.muted, fontSize: 11, fontWeight: "600", textTransform: "uppercase" },
    pillNum: { color: c.ink, fontSize: 16, fontWeight: "700", marginTop: 2 },
    pillToday: { color: c.accent },
    pillTextOn: { color: c.accentInk },
    agenda: { paddingHorizontal: 16, paddingTop: 4 },
    agendaRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: c.border,
    },
    agendaTime: { width: 64, color: c.muted, fontSize: 13 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    agendaBody: { flex: 1 },
    agendaTitle: { color: c.ink, fontSize: 15, fontWeight: "600" },
    agendaSub: { color: c.muted, fontSize: 13, marginTop: 1 },
    hourLabel: { color: c.muted, fontSize: 11, textAlign: "right", paddingRight: 8, marginTop: -6 },
    hourLine: {
        position: "absolute",
        left: 0,
        right: 0,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.border,
    },
    event: {
        flex: 1,
        borderLeftWidth: 3,
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 3,
        overflow: "hidden",
    },
    eventDragging: {
        shadowColor: "#000",
        shadowOpacity: 0.2,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
        elevation: 6,
    },
    eventTitle: { fontSize: 12, fontWeight: "600" },
    eventSub: { fontSize: 11, opacity: 0.8, marginTop: 1 },
    nowLine: { position: "absolute", left: 0, right: 0, height: 2, backgroundColor: c.danFg },
    detailTime: { color: c.ink, fontSize: 14, marginTop: 10 },
});
