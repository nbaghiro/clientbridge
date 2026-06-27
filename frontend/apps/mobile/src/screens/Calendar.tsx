import {
    type CalendarEvent,
    addDays,
    dateKey,
    dayBounds,
    formatHour,
    formatTime,
    formatWeekday,
    groupByDay,
    layoutDay,
    sameDay,
    setBookingStatus,
    startOfDay,
    useCalendarEvents,
    weekColumns,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "../lib/api";

const c = theme.colors;
const HOUR_PX = 56;
const PX_PER_MIN = HOUR_PX / 60;
const GUTTER = 52;

type View2 = "agenda" | "day";

function statusColors(status: string): { bg: string; fg: string; border: string } {
    switch (status) {
        case "completed":
            return { bg: c.okBg, fg: c.okFg, border: c.okFg };
        case "pending":
            return { bg: c.warnBg, fg: c.warnFg, border: c.warnFg };
        case "no_show":
            return { bg: c.danBg, fg: c.danFg, border: c.danFg };
        case "confirmed":
            return { bg: c.accentWeak, fg: c.accentStrong, border: c.accent };
        default:
            return { bg: c.surface, fg: c.ink, border: c.border };
    }
}

const eventLabel = (e: CalendarEvent): string => (e.subtitle.length > 0 ? e.subtitle : e.title);

export function CalendarScreen() {
    const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
    const [view, setView] = useState<View2>("agenda");
    const [detail, setDetail] = useState<CalendarEvent | null>(null);

    const week = weekColumns(anchor);
    const rangeStart = week[0] ?? startOfDay(anchor);
    const rangeEnd = addDays(week[6] ?? anchor, 1);
    const events = useCalendarEvents(rangeStart, rangeEnd);
    const now = new Date();

    const dayEvents = (groupByDay(events).get(dateKey(anchor)) ?? []).sort(
        (a, b) => a.start.getTime() - b.start.getTime(),
    );

    return (
        <SafeAreaView edges={["top"]} style={styles.screen}>
            <View style={styles.header}>
                <Text style={styles.month}>
                    {anchor.toLocaleDateString("en-CA", { month: "long", year: "numeric" })}
                </Text>
                <View style={styles.segment}>
                    {(["agenda", "day"] as const).map((v) => (
                        <Pressable
                            key={v}
                            onPress={() => {
                                setView(v);
                            }}
                            style={[styles.segBtn, view === v && styles.segBtnOn]}
                        >
                            <Text style={[styles.segText, view === v && styles.segTextOn]}>
                                {v === "agenda" ? "Agenda" : "Day"}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            </View>

            <View style={styles.strip}>
                <Pressable
                    onPress={() => {
                        setAnchor((a) => addDays(a, -7));
                    }}
                    hitSlop={8}
                >
                    <Text style={styles.chev}>‹</Text>
                </Pressable>
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
                <Pressable
                    onPress={() => {
                        setAnchor((a) => addDays(a, 7));
                    }}
                    hitSlop={8}
                >
                    <Text style={styles.chev}>›</Text>
                </Pressable>
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
        return (
            <View style={styles.empty}>
                <Text style={styles.emptyText}>No bookings</Text>
            </View>
        );
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
    const nowTop = (now.getHours() * 60 + now.getMinutes()) * PX_PER_MIN - offsetPx;

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
                {positioned.map((pe) => {
                    const sc = statusColors(pe.event.status);
                    return (
                        <View
                            key={pe.event.id}
                            style={{
                                position: "absolute",
                                top: pe.topPx - offsetPx,
                                height: pe.heightPx,
                                left: `${pe.leftPct}%`,
                                width: `${pe.widthPct}%`,
                                paddingHorizontal: 2,
                            }}
                        >
                            <Pressable
                                onPress={() => {
                                    onEventPress(pe.event);
                                }}
                                style={[
                                    styles.event,
                                    { backgroundColor: sc.bg, borderLeftColor: sc.border },
                                ]}
                            >
                                <Text
                                    style={[styles.eventTitle, { color: sc.fg }]}
                                    numberOfLines={1}
                                >
                                    {eventLabel(pe.event)}
                                </Text>
                                {pe.heightPx > 32 ? (
                                    <Text
                                        style={[styles.eventSub, { color: sc.fg }]}
                                        numberOfLines={1}
                                    >
                                        {formatTime(pe.event.start)} · {pe.event.title}
                                    </Text>
                                ) : null}
                            </Pressable>
                        </View>
                    );
                })}
                {showNow && nowTop >= 0 && nowTop <= gridHeight ? (
                    <View style={[styles.nowLine, { top: nowTop }]} />
                ) : null}
            </View>
        </ScrollView>
    );
}

function EventDetailSheet({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
    const [busy, setBusy] = useState(false);
    const cancel = async (): Promise<void> => {
        if (event.bookingId === null) {
            onClose();
            return;
        }
        setBusy(true);
        try {
            await setBookingStatus(api, event.bookingId, "canceled");
            onClose();
        } catch {
            setBusy(false);
        }
    };
    const sc = statusColors(event.status);
    return (
        <Modal visible transparent animationType="slide" onRequestClose={onClose}>
            <Pressable style={styles.detailBackdrop} onPress={onClose}>
                <View style={styles.detailSheet} onStartShouldSetResponder={() => true}>
                    <View style={styles.detailHead}>
                        <View style={styles.agendaBody}>
                            <Text style={styles.detailTitle}>{event.title}</Text>
                            {event.subtitle.length > 0 ? (
                                <Text style={styles.detailSub}>{event.subtitle}</Text>
                            ) : null}
                        </View>
                        <View style={[styles.badge, { backgroundColor: sc.bg }]}>
                            <Text style={[styles.badgeText, { color: sc.fg }]}>{event.status}</Text>
                        </View>
                    </View>
                    <Text style={styles.detailTime}>
                        {formatTime(event.start)} – {formatTime(event.end)}
                    </Text>
                    {event.bookingId !== null && event.status !== "canceled" ? (
                        <Pressable
                            onPress={() => {
                                void cancel();
                            }}
                            disabled={busy}
                            style={[styles.cancelBooking, busy && styles.dim]}
                        >
                            <Text style={styles.cancelBookingText}>
                                {busy ? "Canceling…" : "Cancel booking"}
                            </Text>
                        </Pressable>
                    ) : null}
                </View>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    month: { color: c.ink, fontSize: 20, fontWeight: "700", letterSpacing: -0.3 },
    segment: { flexDirection: "row", backgroundColor: c.surface, borderRadius: 8, padding: 2 },
    segBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6 },
    segBtnOn: { backgroundColor: c.accent },
    segText: { color: c.muted, fontSize: 13, fontWeight: "600" },
    segTextOn: { color: c.accentInk },
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
    empty: { flex: 1, alignItems: "center", justifyContent: "center" },
    emptyText: { color: c.muted, fontSize: 15 },
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
    eventTitle: { fontSize: 12, fontWeight: "600" },
    eventSub: { fontSize: 11, opacity: 0.8, marginTop: 1 },
    nowLine: { position: "absolute", left: 0, right: 0, height: 2, backgroundColor: c.danFg },
    detailBackdrop: { flex: 1, backgroundColor: "rgba(20,25,30,0.4)", justifyContent: "flex-end" },
    detailSheet: {
        backgroundColor: c.bg,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        paddingHorizontal: 20,
        paddingTop: 18,
        paddingBottom: 36,
    },
    detailHead: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
    detailTitle: { color: c.ink, fontSize: 18, fontWeight: "700" },
    detailSub: { color: c.muted, fontSize: 14, marginTop: 2 },
    detailTime: { color: c.ink, fontSize: 14, marginTop: 10 },
    badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    badgeText: { fontSize: 12, fontWeight: "600" },
    cancelBooking: {
        marginTop: 18,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.danFg,
        borderRadius: 10,
        paddingVertical: 12,
        alignItems: "center",
    },
    cancelBookingText: { color: c.danFg, fontSize: 15, fontWeight: "600" },
    dim: { opacity: 0.5 },
});
