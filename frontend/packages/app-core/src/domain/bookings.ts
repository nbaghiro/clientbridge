import { useBusinessQuery as useQuery } from "../hooks";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type ApiLike, type Attempt, attemptKey, failureMessage } from "../api";
import {
    addDays,
    addMonths,
    clockKey,
    combineDayAndTime,
    dateKey,
    formatClock,
    formatDate,
    formatDayNumber,
    formatDayTime,
    formatFullDate,
    formatShortDayTime,
    formatShortTimeRange,
    formatTime,
    formatTimeOfPeriod,
    formatTimeRange,
    formatWeekday,
    formatWeekdayTime,
    minutesInto,
    parseTimestamp,
    sameDay,
    startOfDay,
    startOfWeek,
    utcBeforeSql,
    utcSql,
    wallTime,
    useBusinessZone,
} from "../datetime";
import {
    firstName,
    formatList,
    formatMoney,
    formatParts,
    formatPhone,
    initials,
    BUSINESS_CURRENCY,
} from "../format";
import { type Load, isConnectionFailure, useAsyncAction, useNow } from "../hooks";
import { strings } from "../strings";
import type { CalendarEventFlag, Intent, OptionMedia, TimelineEntry } from "../ui";
import type { Viewer } from "./auth";
import { type ItemRow, bookableItems, useCatalogItems } from "./catalog";
import { type Checkout, useCheckout } from "./checkout";
import { type ClientRow, useClients } from "./clients";
import {
    type Photo,
    bookingPhotoTarget,
    personMedia,
    useFileLinks,
    useFileUpload,
    usePeoplePhotos,
} from "./files";
import { canManagePayments } from "./payments";
import { isPlace, mapsUrl, visitAddress } from "./publicBooking";
import { type StaffRow, staffName, useStaff } from "./staff";
import {
    type SubjectKind,
    parseAttributes,
    subjectSummary,
    subjectTemperament,
    useSubjectKind,
} from "./subjects";
import { type Arrival, expectArrival, useArrival, useReplicaLoad, useHistoryRange } from "./sync";

const MIN = 60_000;
const s = strings.bookings;

export interface CalendarEvent {
    id: string;
    slotId: string;
    bookingId: string | null;
    start: Date;
    end: Date;
    title: string;
    subtitle: string;
    status: string;
    staffId: string;
    clientId: string | null;
    color: string | null;
    capacity: number;
    bookedCount: number;
    depositRequired: boolean;
    depositAmountCents: number;
    depositStatus: string;
    itemId: string;
    // The service's buffers, which the server counts as part of the visit when checking overlaps.
    bufferBeforeMin: number;
    bufferAfterMin: number;
}

interface PositionedEvent {
    event: CalendarEvent;
    topPx: number;
    heightPx: number;
    leftPct: number;
    widthPct: number;
}

// The status → intent decision is shared; each platform maps the intent to its own tokens.
function statusIntent(status: string): Intent {
    switch (status) {
        case "confirmed":
            return "accent";
        case "completed":
            return "success";
        case "pending":
            return "warning";
        case "no_show":
            return "danger";
        default:
            return "neutral";
    }
}

const minuteOfDay = (d: Date, zone: string): number => {
    const w = wallTime(d, zone);
    return w.hour * 60 + w.minute;
};

interface LayoutOptions {
    dayStart: Date;
    zone: string;
    pxPerMin: number;
    minHeightPx?: number;
    gapPx?: number;
}

function compareEventStart(a: CalendarEvent, b: CalendarEvent): number {
    return a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime();
}

// Overlapping events chain into a group, then split into first-fit columns so none visually overlap.
export function layoutDay(events: CalendarEvent[], opts: LayoutOptions): PositionedEvent[] {
    const { dayStart, zone, pxPerMin, minHeightPx = 18, gapPx = 1 } = opts;
    const dayEnd = addDays(dayStart, 1, zone);
    // Wall-clock minutes, as the hour lines are drawn, so 23 and 25 hour days still line up.
    const startMinute = (d: Date): number => (d <= dayStart ? 0 : minuteOfDay(d, zone));
    const endMinute = (d: Date): number => (d >= dayEnd ? 1440 : minuteOfDay(d, zone));
    const inDay = events
        .filter((e) => e.start < dayEnd && e.end > dayStart)
        .sort(compareEventStart);
    const out: PositionedEvent[] = [];
    let group: CalendarEvent[] = [];
    let groupMaxEnd = 0;
    const flush = (): void => {
        if (group.length === 0) return;
        const colEnds: number[] = [];
        const colOf = new Map<string, number>();
        for (const e of group) {
            const startMs = e.start.getTime();
            let col = colEnds.findIndex((end) => end <= startMs);
            if (col === -1) {
                col = colEnds.length;
                colEnds.push(e.end.getTime());
            } else {
                colEnds[col] = e.end.getTime();
            }
            colOf.set(e.id, col);
        }
        const colCount = colEnds.length;
        for (const e of group) {
            const col = colOf.get(e.id) ?? 0;
            const startMin = startMinute(e.start);
            const endMin = Math.max(startMin, endMinute(e.end));
            out.push({
                event: e,
                topPx: startMin * pxPerMin,
                heightPx: Math.max((endMin - startMin) * pxPerMin - gapPx, minHeightPx),
                leftPct: (col / colCount) * 100,
                widthPct: (1 / colCount) * 100,
            });
        }
        group = [];
        groupMaxEnd = 0;
    };
    for (const e of inDay) {
        if (group.length > 0 && e.start.getTime() >= groupMaxEnd) flush();
        group.push(e);
        groupMaxEnd = Math.max(groupMaxEnd, e.end.getTime());
    }
    flush();
    return out;
}

// The replica stores timestamptz as "...Z" or a bare "+00" offset, which SQLite only parses as "+00:00".
type EventSource = "online" | "staff";

const omitKey = <T>(rec: Record<string, T>, key: string): Record<string, T> =>
    Object.fromEntries(Object.entries(rec).filter(([k]) => k !== key));

export interface ScheduleEvent extends CalendarEvent {
    kind: "visit" | "class";
    priceCents: number;
    serviceName: string;
    clientName: string | null;
    subjectName: string | null;
    staffName: string;
    staffShort: string;
    staffColor: string | null;
    source: EventSource;
    seriesId: string | null;
    addonCount: number;
    note: string | null;
    departedAt: Date | null;
    checkedIn: boolean;
    bookedAt: Date | null;
    remindedAt: Date | null;
    intent: Intent;
    // Ended but still open: staff owe it a Completed or a No-show.
    needsClose: boolean;
    // Still ahead but now inside a closure or the member's time off, so it needs a new time.
    needsMove: boolean;
    inProgress: boolean;
    timeLabel: string;
    timeShort: string;
    // The line a block, row or screen reader leads with: "Bella · Amélie Tremblay" or the class name.
    headline: string;
}

interface EventRow {
    slot_id: string;
    starts_at: string;
    ends_at: string;
    staff_id: string;
    capacity: number;
    slot_status: string;
    recurrence_id: string | null;
    item_id: string;
    item_name: string;
    item_color: string | null;
    item_price: number;
    buffer_before_min: number;
    buffer_after_min: number;
    booked_count: number;
    booking_id: string | null;
    booking_status: string | null;
    client_id: string | null;
    client_name: string | null;
    subject_name: string | null;
    source: string | null;
    deposit_amount_cents: number | null;
    deposit_status: string | null;
    booking_price: number | null;
    departed_at: string | null;
    checked_in_at: string | null;
    booked_at: string | null;
    reminded_at: string | null;
    addon_count: number;
    note: string | null;
}

// SQLite ignores a replica index on the right side of a LEFT JOIN, so the slot's bookings join by id.
export function slotBookingsJoin(conditions: string): string {
    return `LEFT JOIN bookings b ON b.id IN (SELECT x.id FROM bookings x WHERE x.slot_id = s.id ${conditions})`;
}

/** Slots overlapping the instants `start` to `end` (SQL parameters), through the starts_at index. */
export function slotOverlapSql(start: string, end: string): string {
    return `${utcBeforeSql("s.starts_at", end)}
  AND ${utcSql("s.starts_at")} < datetime(${end}) AND ${utcSql("s.ends_at")} > datetime(${start})`;
}

// One row per visit; a class session (capacity over one) is one row with its seats counted.
export const EVENTS_SQL = `
SELECT s.id AS slot_id, s.starts_at, s.ends_at, s.staff_id, s.capacity, s.status AS slot_status,
       s.recurrence_id,
       i.id AS item_id, i.name AS item_name, i.color AS item_color, i.price_cents AS item_price,
       i.buffer_before_min, i.buffer_after_min,
       (SELECT COUNT(*) FROM bookings x WHERE x.slot_id = s.id
          AND x.status NOT IN ('canceled', 'waitlisted') AND x.deleted_at IS NULL) AS booked_count,
       b.id AS booking_id, b.status AS booking_status, b.client_id, c.name AS client_name,
       sj.name AS subject_name, b.source, b.deposit_amount_cents, b.deposit_status,
       b.price_cents AS booking_price, b.departed_at, b.checked_in_at, b.created_at AS booked_at,
       b.reminded_at,
       (SELECT COUNT(*) FROM addons a WHERE a.booking_id = b.id) AS addon_count,
       (SELECT n.body FROM notes n WHERE n.parent_type = 'booking' AND n.parent_id = b.id
          ORDER BY n.created_at LIMIT 1) AS note
FROM slots s
JOIN items i ON i.id = s.item_id
${slotBookingsJoin("AND s.capacity <= 1 AND x.deleted_at IS NULL AND x.status != 'canceled'")}
LEFT JOIN clients c ON c.id = b.client_id
LEFT JOIN subjects sj ON sj.id = b.subject_id
WHERE s.status != 'canceled' AND ${slotOverlapSql("?2", "?1")}
ORDER BY s.starts_at`;

function enrich(r: EventRow, staff: Map<string, StaffRow>, now: Date, zone: string): ScheduleEvent {
    const start = parseTimestamp(r.starts_at);
    const end = parseTimestamp(r.ends_at);
    const isClass = r.capacity > 1;
    const status = isClass ? r.slot_status : (r.booking_status ?? r.slot_status);
    const member = staff.get(r.staff_id);
    const name = member ? staffName(member) : "";
    const open = status === "confirmed" || status === "pending" || status === "scheduled";
    const headline = isClass ? r.item_name : formatParts([r.subject_name, r.client_name]);
    return {
        id: r.booking_id ?? r.slot_id,
        slotId: r.slot_id,
        bookingId: isClass ? null : r.booking_id,
        start,
        end,
        title: r.item_name,
        subtitle: r.client_name ?? "",
        status,
        staffId: r.staff_id,
        clientId: r.client_id,
        color: r.item_color,
        capacity: r.capacity,
        bookedCount: r.booked_count,
        depositRequired: (r.deposit_amount_cents ?? 0) > 0,
        depositAmountCents: r.deposit_amount_cents ?? 0,
        depositStatus: r.deposit_status ?? "none",
        kind: isClass ? "class" : "visit",
        itemId: r.item_id,
        bufferBeforeMin: r.buffer_before_min,
        bufferAfterMin: r.buffer_after_min,
        priceCents: isClass ? r.item_price : (r.booking_price ?? r.item_price),
        serviceName: r.item_name,
        clientName: r.client_name,
        subjectName: r.subject_name,
        staffName: name,
        staffShort: firstName(name),
        staffColor: member?.color ?? null,
        source: r.source === "online" ? "online" : "staff",
        seriesId: r.recurrence_id,
        addonCount: r.addon_count,
        note: r.note,
        departedAt: r.departed_at !== null ? parseTimestamp(r.departed_at) : null,
        checkedIn: r.checked_in_at !== null,
        bookedAt: r.booked_at !== null ? parseTimestamp(r.booked_at) : null,
        remindedAt: r.reminded_at !== null ? parseTimestamp(r.reminded_at) : null,
        intent: statusIntent(status),
        needsClose: open && !isClass && end <= now,
        needsMove: false,
        inProgress: open && start <= now && end > now,
        timeLabel: formatTimeRange(start, end, zone),
        timeShort: formatShortTimeRange(start, end, zone),
        headline: headline === "" ? r.item_name : headline,
    };
}

/** The current time, refreshed every `ms`, so now lines and "needs closing" keep up. */
interface ActiveStaff {
    rows: StaffRow[];
    byId: Map<string, StaffRow>;
}

function useActiveStaff(): ActiveStaff {
    const staff = useStaff();
    return useMemo(() => {
        const rows = staff.filter((x) => x.status === "active");
        return { rows, byId: new Map(rows.map((x) => [x.id, x])) };
    }, [staff]);
}

/** Every visit between two times, with client, subject, series and add-on count. */
export function useScheduleEvents(
    start: Date,
    end: Date,
): {
    events: ScheduleEvent[];
    isLoading: boolean;
    error: Error | undefined;
    unavailable: boolean;
    refresh: () => void;
} {
    const coverage = useHistoryRange(start, end);
    const { data, isLoading, error } = useQuery<EventRow>(EVENTS_SQL, [
        end.toISOString(),
        start.toISOString(),
    ]);
    const staff = useActiveStaff();
    const now = useNow();
    const zone = useBusinessZone();
    const events = useMemo(
        () => data.map((r) => enrich(r, staff.byId, now, zone)),
        [data, staff.byId, now, zone],
    );
    return {
        events,
        isLoading: isLoading || coverage.isLoading,
        error: error ?? coverage.error ?? undefined,
        unavailable: coverage.unavailable,
        refresh: () => {
            Promise.resolve(coverage.refresh?.()).catch(() => undefined);
        },
    };
}

interface HoursRow {
    staff_id: string;
    basis: string;
    weekday: number | null;
    date: string | null;
    start_time: string | null;
    end_time: string | null;
    available: number;
}

interface AwayRow {
    id: string;
    staff_id: string | null;
    starts_at: string;
    ends_at: string;
    reason: string | null;
}

export const WORKING_HOURS_SQL =
    "SELECT staff_id, basis, weekday, date, start_time, end_time, available FROM hours WHERE basis IN ('recurring', 'date')";

export const AWAY_SQL = `
SELECT id, staff_id, starts_at, ends_at, reason FROM hours
WHERE basis = 'exception' AND ${utcBeforeSql("starts_at", "?1")}
  AND ${utcSql("starts_at")} < datetime(?1) AND ${utcSql("ends_at")} > datetime(?2)
ORDER BY starts_at`;

export interface ScheduleBlock {
    id: string;
    staffId: string | null;
    start: Date;
    end: Date;
    kind: "time_off" | "break" | "closure";
    label: string;
}

interface Window {
    start: Date;
    end: Date;
}

const weekdayIndex = (d: Date, zone: string): number => (wallTime(d, zone).weekday + 6) % 7;

/** Hours, time off and closures for a range, and the checks the server makes before a booking. */
export interface Availability {
    // Open windows a member works on a day; null when they have no hours set (the server allows any time).
    windows: (staffId: string, day: Date) => Window[] | null;
    hours: (staffId: string, day: Date) => Window | null;
    blocks: (day: Date) => ScheduleBlock[];
    away: (staffId: string, start: Date, end: Date) => ScheduleBlock | null;
    isClosed: (day: Date) => ScheduleBlock | null;
    awayRows: ScheduleBlock[];
    zone: string;
}

export function useAvailability(start: Date, end: Date): Availability & { sources: LoadSources } {
    const hours = useQuery<HoursRow>(WORKING_HOURS_SQL);
    const away = useQuery<AwayRow>(AWAY_SQL, [end.toISOString(), start.toISOString()]);
    const zone = useBusinessZone();
    const availability = useMemo(
        () => buildAvailability(hours.data, away.data, zone),
        [hours.data, away.data, zone],
    );
    return { ...availability, sources: [hours, away] };
}

type LoadSources = { isLoading: boolean; error?: Error | undefined }[];

export function buildAvailability(hours: HoursRow[], away: AwayRow[], zone: string): Availability {
    const awayRows: ScheduleBlock[] = away.map((a) => ({
        id: a.id,
        staffId: a.staff_id,
        start: parseTimestamp(a.starts_at),
        end: parseTimestamp(a.ends_at),
        kind: a.staff_id === null ? "closure" : "time_off",
        label: a.reason ?? "",
    }));
    const windows = (staffId: string, day: Date): Window[] | null => {
        const key = dateKey(day, zone);
        const dated = hours.filter(
            (h) => h.staff_id === staffId && h.basis === "date" && h.date === key,
        );
        const rows =
            dated.length > 0
                ? dated
                : hours.filter(
                      (h) =>
                          h.staff_id === staffId &&
                          h.basis === "recurring" &&
                          h.weekday === weekdayIndex(day, zone),
                  );
        if (rows.length === 0) return null;
        return rows
            .filter((h) => h.available === 1)
            .map((h) => ({
                start: combineDayAndTime(day, h.start_time ?? "00:00", zone),
                end:
                    h.end_time === null
                        ? addDays(day, 1, zone)
                        : combineDayAndTime(day, h.end_time, zone),
            }))
            .sort((a, b) => a.start.getTime() - b.start.getTime());
    };
    const blocks = (day: Date): ScheduleBlock[] => {
        const from = startOfDay(day, zone);
        const to = addDays(from, 1, zone);
        const away = awayRows.filter((b) => b.start < to && b.end > from);
        const staffIds = new Set(hours.map((h) => h.staff_id));
        const breaks: ScheduleBlock[] = [];
        for (const id of staffIds) {
            const w = windows(id, day) ?? [];
            for (let i = 1; i < w.length; i++) {
                const prev = w[i - 1];
                const cur = w[i];
                if (prev !== undefined && cur !== undefined && cur.start > prev.end) {
                    breaks.push({
                        id: `break_${id}_${String(i)}`,
                        staffId: id,
                        start: prev.end,
                        end: cur.start,
                        kind: "break",
                        label: s.breakLabel,
                    });
                }
            }
        }
        return [...away, ...breaks];
    };
    return {
        windows,
        hours: (staffId, day) => {
            const w = windows(staffId, day);
            const first = w?.[0];
            const last = w?.at(-1);
            if (first === undefined || last === undefined) return null;
            return { start: first.start, end: last.end };
        },
        blocks,
        away: (staffId, start, end) =>
            awayRows.find(
                (b) =>
                    (b.staffId === null || b.staffId === staffId) && b.start < end && b.end > start,
            ) ?? null,
        isClosed: (day) => {
            const from = startOfDay(day, zone);
            const to = addDays(from, 1, zone);
            return (
                awayRows.find((b) => b.staffId === null && b.start <= from && b.end >= to) ?? null
            );
        },
        awayRows,
        zone,
    };
}

type MoveProblem = "overlap" | "off_hours" | "time_off" | "closed" | "past" | "full" | null;

/** The service being placed: its buffers widen the overlap check and a class with seats is joined. */
export interface SlotItem {
    id: string;
    capacity: number | null;
    bufferBeforeMin: number;
    bufferAfterMin: number;
}

export interface SlotTarget {
    item?: SlotItem | null;
}

export const slotItemOf = (item: ItemRow): SlotItem => ({
    id: item.id,
    capacity: item.capacity,
    bufferBeforeMin: item.buffer_before_min,
    bufferAfterMin: item.buffer_after_min,
});

const eventItem = (e: CalendarEvent): SlotItem => ({
    id: e.itemId,
    capacity: e.capacity,
    bufferBeforeMin: e.bufferBeforeMin,
    bufferAfterMin: e.bufferAfterMin,
});

export interface MovePlan {
    start: Date;
    end: Date;
    staffId: string;
    label: string;
    problem: MoveProblem;
    message: string;
}

/** Why a visit can't go at this time for this person, checked the way the server checks it. */
export function slotProblem(
    avail: Availability,
    events: readonly CalendarEvent[],
    staff: Map<string, StaffRow>,
    staffId: string,
    start: Date,
    end: Date,
    ignoreId: string | null,
    target: SlotTarget = {},
): { problem: MoveProblem; message: string } {
    const zone = avail.zone;
    const member = staff.get(staffId);
    const who = member ? firstName(staffName(member)) : "";
    const away = avail.away(staffId, start, end);
    if (away?.staffId === null) return { problem: "closed", message: s.problemClosed(away.label) };
    if (away) return { problem: "time_off", message: s.problemTimeOff(who, away.label) };
    const w = avail.windows(staffId, start);
    if (
        w !== null &&
        (dateKey(end, zone) !== dateKey(start, zone) ||
            !w.some((x) => x.start <= start && end <= x.end))
    ) {
        return { problem: "off_hours", message: s.problemOffHours(who) };
    }
    const live = events.filter((e) => e.id !== ignoreId && e.status !== "canceled");
    const item = target.item ?? null;
    if (item !== null && (item.capacity ?? 1) > 1) {
        const session = live.find(
            (e) =>
                e.itemId === item.id &&
                e.staffId === staffId &&
                e.start.getTime() === start.getTime(),
        );
        if (session) {
            return session.bookedCount >= session.capacity
                ? { problem: "full", message: s.problemClassFull }
                : { problem: null, message: "" };
        }
    }
    const from = start.getTime() - (item?.bufferBeforeMin ?? 0) * MIN;
    const to = end.getTime() + (item?.bufferAfterMin ?? 0) * MIN;
    const joinable = (e: CalendarEvent): boolean =>
        item !== null &&
        e.bookedCount < e.capacity &&
        e.itemId === item.id &&
        e.start.getTime() === start.getTime() &&
        e.end.getTime() === end.getTime();
    const clash = live.find(
        (e) =>
            e.staffId === staffId &&
            e.start.getTime() - e.bufferBeforeMin * MIN < to &&
            e.end.getTime() + e.bufferAfterMin * MIN > from &&
            !joinable(e),
    );
    if (clash) return { problem: "overlap", message: s.problemOverlap(who) };
    return { problem: null, message: "" };
}

/** Where a drag would land (snapped to 5 minutes) and whether the server would refuse it. */
export function planMove(
    event: ScheduleEvent,
    deltaMin: number,
    staffId: string,
    ctx: { avail: Availability; events: readonly CalendarEvent[]; staff: Map<string, StaffRow> },
    now: Date,
    mode: "move" | "resize" = "move",
): MovePlan {
    const snapped = Math.round(deltaMin / 5) * 5;
    const length = (event.end.getTime() - event.start.getTime()) / MIN;
    const start = mode === "move" ? new Date(event.start.getTime() + snapped * MIN) : event.start;
    const end = new Date(
        event.end.getTime() + (mode === "resize" ? Math.max(snapped, 15 - length) : snapped) * MIN,
    );
    const member = ctx.staff.get(staffId);
    const who = member ? firstName(staffName(member)) : "";
    const zone = ctx.avail.zone;
    const found =
        mode === "move" && start < now && start.getTime() !== event.start.getTime()
            ? { problem: "past" as const, message: s.problemPast }
            : slotProblem(ctx.avail, ctx.events, ctx.staff, staffId, start, end, event.id, {
                  item: eventItem(event),
              });
    const message =
        found.problem !== null
            ? found.message
            : mode === "resize"
              ? s.resizeTo(
                    formatTime(end, zone),
                    Math.round((end.getTime() - start.getTime()) / MIN),
                )
              : s.dragTo(formatWeekdayTime(start, zone), who);
    return {
        start,
        end,
        staffId,
        label: formatTimeRange(start, end, zone),
        problem: found.problem,
        message,
    };
}

interface ServerVerdict {
    ok: boolean;
    problem: string | null;
    reason: string | null;
    message: string | null;
}

interface PendingMove {
    start: Date;
    end: Date;
    staffId: string;
}

function verdictMessage(v: ServerVerdict, who: string): string {
    switch (v.problem) {
        case "overlap":
            return s.problemOverlap(who);
        case "off_hours":
            return s.problemOffHours(who);
        case "time_off":
            return s.problemTimeOff(who, v.reason ?? "");
        case "closed":
            return s.problemClosed(v.reason ?? "");
        case "past":
            return s.problemPast;
        case "class":
            return s.problemClass;
        default:
            return s.dropRefused;
    }
}

export interface MoveEvent {
    // Asks the server for its verdict on where a drag is hovering; the answer lands in `verdict`.
    check: (event: ScheduleEvent, plan: MovePlan) => void;
    verdict: { key: string; ok: boolean; message: string } | null;
    move: (event: ScheduleEvent, plan: MovePlan) => void;
    // Moves shown before sync brings the new times back.
    pending: Record<string, PendingMove>;
    // Drops the moves the replica now shows, so the board reads its own rows again.
    settle: (events: readonly CalendarEvent[]) => void;
    last: MovePlan | null;
    refusal: string | null;
    undo: () => void;
    dismiss: () => void;
}

/** The pending moves the replica doesn't show yet; the same object when none have arrived. */
export function settleMoves(
    pending: Record<string, PendingMove>,
    events: readonly CalendarEvent[],
): Record<string, PendingMove> {
    const arrived = new Set(
        events
            .filter((e) => {
                const p = pending[e.id];
                return (
                    p !== undefined &&
                    +p.start === +e.start &&
                    +p.end === +e.end &&
                    p.staffId === e.staffId
                );
            })
            .map((e) => e.id),
    );
    const visible = new Set(events.map((event) => event.id));
    for (const id of Object.keys(pending)) if (!visible.has(id)) arrived.add(id);
    if (arrived.size === 0) return pending;
    return Object.fromEntries(Object.entries(pending).filter(([id]) => !arrived.has(id)));
}

/** Why a move or reschedule didn't happen: no connection, or the server refused the time. */
export function moveFailure(error: unknown): string {
    return isConnectionFailure(error) ? s.moveOffline : failureMessage(error, s.rescheduleError);
}

const planKey = (eventId: string, p: { start: Date; end: Date; staffId: string }): string =>
    `${eventId}|${p.staffId}|${String(p.start.getTime())}|${String(p.end.getTime())}`;

/** Moves and resizes a visit: the server's verdict while hovering, then the move, with undo. */
export function useMoveEvent(api: ApiLike): MoveEvent {
    const staff = useActiveStaff().byId;
    const [verdict, setVerdict] = useState<{ key: string; ok: boolean; message: string } | null>(
        null,
    );
    const [pending, setPending] = useState<Record<string, PendingMove>>({});
    const [last, setLast] = useState<{ plan: MovePlan; event: ScheduleEvent } | null>(null);
    const [refusal, setRefusal] = useState<string | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const asked = useRef<string | null>(null);
    const moving = useRef(false);

    useEffect(
        () => () => {
            if (timer.current !== null) clearTimeout(timer.current);
        },
        [],
    );

    const who = (id: string): string => {
        const m = staff.get(id);
        return m ? firstName(staffName(m)) : "";
    };

    const settle = useCallback((events: readonly CalendarEvent[]) => {
        setPending((p) => settleMoves(p, events));
    }, []);

    const patch = (
        event: ScheduleEvent,
        to: PendingMove,
        onFail: (error: unknown) => void,
        onSuccess?: () => void,
    ): void => {
        const bookingId = event.bookingId;
        if (bookingId === null || moving.current) return;
        moving.current = true;
        setPending((p) => ({ ...p, [event.id]: to }));
        api.patch(`/v1/bookings/${bookingId}`, {
            starts_at: to.start.toISOString(),
            ends_at: to.end.toISOString(),
            staff_id: to.staffId,
        })
            .then(() => {
                onSuccess?.();
            })
            .catch((error: unknown) => {
                setPending((prev) => omitKey(prev, event.id));
                onFail(error);
            })
            .finally(() => {
                moving.current = false;
            });
    };

    return {
        check: (event, plan) => {
            const key = planKey(event.id, plan);
            if (asked.current === key || event.bookingId === null) return;
            asked.current = key;
            if (timer.current !== null) clearTimeout(timer.current);
            if (plan.problem !== null) return;
            const bookingId = event.bookingId;
            timer.current = setTimeout(() => {
                api.post<ServerVerdict>(`/v1/bookings/${bookingId}/check`, {
                    starts_at: plan.start.toISOString(),
                    ends_at: plan.end.toISOString(),
                    staff_id: plan.staffId,
                })
                    .then((v) => {
                        setVerdict({
                            key,
                            ok: v.ok,
                            message: v.ok ? plan.message : verdictMessage(v, who(plan.staffId)),
                        });
                    })
                    .catch(() => undefined);
            }, 120);
        },
        verdict,
        move: (event, plan) => {
            if (moving.current) return;
            const key = planKey(event.id, plan);
            const refused = verdict?.key === key && !verdict.ok ? verdict.message : null;
            if (plan.problem !== null || refused !== null) {
                setRefusal(refused ?? plan.message);
                setTimeout(() => {
                    setRefusal(null);
                }, 3200);
                return;
            }
            setRefusal(null);
            setLast(null);
            patch(
                event,
                plan,
                (error) => {
                    setRefusal(moveFailure(error));
                },
                () => {
                    setLast({ plan, event });
                },
            );
        },
        pending,
        settle,
        last: last?.plan ?? null,
        refusal,
        undo: () => {
            if (!last) return;
            const { event } = last;
            setLast(null);
            patch(
                event,
                { start: event.start, end: event.end, staffId: event.staffId },
                (error) => {
                    setRefusal(isConnectionFailure(error) ? s.moveOffline : s.actionError);
                },
            );
        },
        dismiss: () => {
            setLast(null);
        },
    };
}

export function applyPending(
    events: ScheduleEvent[],
    pending: Record<string, PendingMove>,
    zone: string,
): ScheduleEvent[] {
    if (Object.keys(pending).length === 0) return events;
    return events.map((e) => {
        const p = pending[e.id];
        if (p === undefined) return e;
        return {
            ...e,
            start: p.start,
            end: p.end,
            staffId: p.staffId,
            timeLabel: formatTimeRange(p.start, p.end, zone),
            timeShort: formatShortTimeRange(p.start, p.end, zone),
        };
    });
}

/** Marks visits still ahead that a closure or the member's time off now covers. */
export function markMoves(
    events: ScheduleEvent[],
    away: Availability["away"],
    now: Date,
): ScheduleEvent[] {
    return events.map((e) => {
        const open = e.status === "confirmed" || e.status === "pending" || e.status === "scheduled";
        const needsMove = open && e.start > now && away(e.staffId, e.start, e.end) !== null;
        return needsMove === e.needsMove ? e : { ...e, needsMove };
    });
}

interface StaffLane {
    id: string;
    name: string;
    short: string;
    initials: string;
    color: string | null;
    hours: Window | null;
    unset: boolean;
    hoursLabel: string;
    events: ScheduleEvent[];
    blocks: ScheduleBlock[];
    bookedMin: number;
    availableMin: number;
    utilization: number;
}

export interface DayColumn {
    date: Date;
    key: string;
    isToday: boolean;
    closure: ScheduleBlock | null;
    events: ScheduleEvent[];
    lanes: StaffLane[];
    // Shown over the board on a closed day; the visits on it stay reachable underneath.
    closedNote: string | null;
}

export interface DaySummary {
    visits: number;
    classes: number;
    completed: number;
    toClose: number;
    expectedCents: number;
    openMin: number;
    utilization: number;
}

interface WeekStripDay {
    key: string;
    date: Date;
    weekday: string;
    day: string;
    busy: number;
    closed: boolean;
    isToday: boolean;
    disabled?: boolean;
}

/** Week strip days for a date picker: weekday, number and how busy each day is (0 to 3). */
function weekStrip(
    anchor: Date,
    events: readonly ScheduleEvent[],
    avail: Availability,
    now: Date,
): WeekStripDay[] {
    const zone = avail.zone;
    const first = startOfWeek(anchor, zone);
    return Array.from({ length: 7 }, (_, i) => {
        const date = addDays(first, i, zone);
        const n = events.filter((e) => sameDay(e.start, date, zone)).length;
        return {
            key: dateKey(date, zone),
            date,
            weekday: formatWeekday(date, zone),
            day: formatDayNumber(date, zone),
            busy: n === 0 ? 0 : n < 4 ? 1 : n < 8 ? 2 : 3,
            closed: avail.isClosed(date) !== null,
            isToday: sameDay(date, now, zone),
        };
    });
}

export function laneFor(
    member: StaffRow,
    day: Date,
    events: ScheduleEvent[],
    avail: Availability,
): StaffLane {
    const zone = avail.zone;
    const name = staffName(member);
    const unset = avail.windows(member.id, day) === null;
    const dayStart = startOfDay(day, zone);
    const dayEnd = addDays(day, 1, zone);
    const allDay = avail.away(member.id, dayStart, dayEnd);
    const covers = allDay !== null && allDay.start <= dayStart && allDay.end >= dayEnd;
    const hours = covers ? null : avail.hours(member.id, day);
    const mine = events.filter((e) => e.staffId === member.id && sameDay(e.start, day, zone));
    const blocks = avail.blocks(day).filter((b) => b.staffId === member.id);
    const bookedMin = mine.reduce((sum, e) => sum + (e.end.getTime() - e.start.getTime()) / MIN, 0);
    const blockedMin = hours
        ? blocks.reduce(
              (sum, b) =>
                  sum +
                  Math.max(
                      0,
                      (Math.min(+b.end, +hours.end) - Math.max(+b.start, +hours.start)) / MIN,
                  ),
              0,
          )
        : 0;
    const windowMin = hours
        ? Math.max(0, (hours.end.getTime() - hours.start.getTime()) / MIN - blockedMin)
        : 0;
    return {
        id: member.id,
        name,
        short: firstName(name),
        initials: initials(name),
        color: member.color,
        hours,
        unset: unset && !covers,
        hoursLabel: hours
            ? formatTimeRange(hours.start, hours.end, zone)
            : unset && !covers
              ? s.noHoursSet
              : s.offToday,
        events: mine,
        blocks,
        bookedMin,
        availableMin: windowMin,
        utilization: windowMin > 0 ? Math.min(1, bookedMin / windowMin) : 0,
    };
}

function summarize(day: DayColumn): DaySummary {
    const visits = day.events.filter((e) => e.kind === "visit");
    const windowMin = day.lanes.reduce((sum, l) => sum + l.availableMin, 0);
    const bookedMin = day.lanes.reduce((sum, l) => sum + l.bookedMin, 0);
    return {
        visits: visits.length,
        classes: day.events.filter((e) => e.kind === "class").length,
        completed: visits.filter((e) => e.status === "completed").length,
        toClose: visits.filter((e) => e.needsClose).length,
        expectedCents: day.events.reduce(
            (sum, e) =>
                sum +
                (e.kind === "class"
                    ? e.priceCents * e.bookedCount
                    : e.status === "no_show"
                      ? 0
                      : e.priceCents),
            0,
        ),
        openMin: Math.max(0, windowMin - bookedMin),
        utilization: windowMin > 0 ? Math.round((bookedMin / windowMin) * 100) : 0,
    };
}

export interface ScheduleBoard {
    historyUnavailable: boolean;
    now: Date;
    zone: string;
    anchor: Date;
    setAnchor: (day: Date) => void;
    goToday: () => void;
    shift: (dir: 1 | -1) => void;
    label: string;
    lanes: StaffLane[];
    focus: DayColumn;
    summary: DaySummary;
    events: ScheduleEvent[];
    // Every visit of the anchor's week, for overlap checks and the date strip.
    weekEvents: ScheduleEvent[];
    window: VisibleWindow;
    selectedId: string | null;
    select: (id: string | null) => void;
    selected: ScheduleEvent | null;
    week: WeekStripDay[];
    avail: Availability;
    staff: Map<string, StaffRow>;
    // The members this viewer can book for and move visits to.
    actors: StaffRow[];
    load: Load;
}

const NO_MOVES: Record<string, PendingMove> = {};

export const BOOKING_START_SQL =
    "SELECT s.starts_at FROM bookings b JOIN slots s ON s.id = b.slot_id WHERE b.id = ?";

/** When a booking starts, so a link to it can open the board on its day. */
export function useBookingStart(bookingId: string | null): Date | null {
    const row = useQuery<{ starts_at: string }>(BOOKING_START_SQL, [bookingId ?? ""]).data[0];
    return row ? parseTimestamp(row.starts_at) : null;
}

/** The team day board: one lane per member with hours, time off and visits, plus the day summary. */
export function useScheduleBoard(
    viewer: Viewer | null,
    moves: Pick<MoveEvent, "pending" | "settle"> | null = null,
): ScheduleBoard {
    const now = useNow();
    const zone = useBusinessZone();
    const [anchor, setAnchor] = useState(() => startOfDay(new Date(), zone));
    const [selectedId, select] = useState<string | null>(null);
    const weekStart = startOfWeek(anchor, zone);
    const weekEnd = addDays(weekStart, 7, zone);
    const raw = useScheduleEvents(weekStart, weekEnd);
    const pending = moves?.pending ?? NO_MOVES;
    const settle = moves?.settle;
    useEffect(() => {
        settle?.(raw.events);
    }, [settle, raw.events]);
    const avail = useAvailability(weekStart, weekEnd);
    const staff = useActiveStaff();
    const members = actorsFor(staff.rows, viewer);
    const { away } = avail;
    const weekEvents = useMemo(
        () => markMoves(applyPending(raw.events, pending, zone), away, now),
        [raw.events, pending, zone, away, now],
    );
    const dayEvents = weekEvents.filter((e) => sameDay(e.start, anchor, zone));
    const lanes = members.map((m) => laneFor(m, anchor, weekEvents, avail));
    const closure = avail.isClosed(anchor);
    const focus: DayColumn = {
        date: anchor,
        key: dateKey(anchor, zone),
        isToday: sameDay(anchor, now, zone),
        closure,
        events: dayEvents,
        lanes,
        closedNote:
            closure === null
                ? null
                : s.closedNote(closure.label, dayEvents.filter((e) => e.needsMove).length),
    };
    const window = visibleWindow(
        anchor,
        [...lanes.flatMap((l) => (l.hours ? [l.hours] : [])), ...dayEvents],
        zone,
    );
    const load = useReplicaLoad([raw, ...avail.sources], false);
    return {
        historyUnavailable: raw.unavailable,
        now,
        zone,
        anchor,
        setAnchor: (day) => {
            setAnchor(startOfDay(day, zone));
        },
        goToday: () => {
            setAnchor(startOfDay(new Date(), zone));
        },
        shift: (dir) => {
            setAnchor((a) => addDays(a, dir, zone));
        },
        label: sameDay(anchor, now, zone)
            ? formatParts([s.today, formatFullDate(anchor, zone)])
            : formatFullDate(anchor, zone),
        lanes,
        focus,
        summary: summarize(focus),
        events: dayEvents,
        weekEvents,
        window,
        selectedId,
        select,
        selected: weekEvents.find((e) => e.id === selectedId) ?? null,
        week: weekStrip(anchor, weekEvents, avail, now),
        avail,
        staff: staff.byId,
        actors: members,
        load,
    };
}

export interface PlacedEvent {
    event: ScheduleEvent;
    top: number;
    height: number;
    leftPct: number;
    widthPct: number;
}

/** Positions a lane's visits in pixels from the top of the visible window, side by side when they overlap. */
export function placeEvents(
    events: ScheduleEvent[],
    day: Date,
    startHour: number,
    pxPerMin: number,
    zone: string,
): PlacedEvent[] {
    const byId = new Map(events.map((e) => [e.id, e]));
    const offset = startHour * 60 * pxPerMin;
    return layoutDay(events, {
        dayStart: startOfDay(day, zone),
        zone,
        pxPerMin,
        minHeightPx: 20,
        gapPx: 2,
    }).flatMap((p) => {
        const event = byId.get(p.event.id);
        return event
            ? [
                  {
                      event,
                      top: p.topPx - offset,
                      height: p.heightPx,
                      leftPct: p.leftPct,
                      widthPct: p.widthPct,
                  },
              ]
            : [];
    });
}

export function minuteTop(d: Date, startHour: number, pxPerMin: number, zone: string): number {
    return (minuteOfDay(d, zone) - startHour * 60) * pxPerMin;
}

/** The hours a day's board shows: every shift and visit, out to midnight when one runs that late. */
export function visibleWindow(
    day: Date,
    spans: readonly { start: Date; end: Date }[],
    zone: string,
): VisibleWindow {
    const dayStart = startOfDay(day, zone);
    const dayEnd = addDays(dayStart, 1, zone);
    let startHour = 24;
    let endHour = 0;
    for (const x of spans) {
        const last = wallTime(x.end, zone);
        startHour = Math.min(startHour, x.start <= dayStart ? 0 : wallTime(x.start, zone).hour);
        endHour = Math.max(endHour, x.end >= dayEnd ? 24 : last.hour + (last.minute > 0 ? 1 : 0));
    }
    return startHour < endHour ? { startHour, endHour } : { startHour: 9, endHour: 17 };
}

/** A block's place in the visible window, in pixels from its top, or null when it falls outside. */
export function blockSpan(
    block: ScheduleBlock,
    day: Date,
    startHour: number,
    endHour: number,
    pxPerMin: number,
    zone: string,
): { top: number; height: number } | null {
    const dayStart = startOfDay(day, zone);
    const dayEnd = addDays(dayStart, 1, zone);
    const minute = (d: Date): number =>
        d <= dayStart ? 0 : d >= dayEnd ? 1440 : minuteOfDay(d, zone);
    const from = Math.max(minute(block.start), startHour * 60);
    const to = Math.min(minute(block.end), endHour * 60);
    if (to <= from) return null;
    return { top: (from - startHour * 60) * pxPerMin, height: (to - from) * pxPerMin };
}

/** Shaded spans outside a lane's working hours (or the whole window on a day off), in minutes from the window start. */
export function offHourSpans(
    lane: StaffLane,
    startHour: number,
    endHour: number,
    zone: string,
): { from: number; to: number }[] {
    const total = (endHour - startHour) * 60;
    if (lane.unset) return [];
    if (!lane.hours) return [{ from: 0, to: total }];
    const a = minuteOfDay(lane.hours.start, zone) - startHour * 60;
    const b = minuteOfDay(lane.hours.end, zone) - startHour * 60;
    return [
        { from: 0, to: Math.max(0, a) },
        { from: Math.min(total, b), to: total },
    ].filter((x) => x.to > x.from);
}

export const hourMarks = (startHour: number, endHour: number): number[] =>
    Array.from({ length: endHour - startHour }, (_, i) => startHour + i);

/** The small flags a calendar block carries, most useful first. */
export function eventFlags(e: ScheduleEvent): CalendarEventFlag[] {
    const flags: CalendarEventFlag[] = [];
    if (e.needsMove) flags.push("needs_move");
    if (e.kind === "class") flags.push("class");
    if (
        e.depositRequired &&
        e.depositStatus === "pending" &&
        (e.status === "confirmed" || e.status === "pending")
    )
        flags.push("deposit_due");
    if (e.seriesId !== null) flags.push("recurring");
    if (e.source === "online") flags.push("online");
    if (e.addonCount > 0) flags.push("addons");
    if (e.note !== null) flags.push("note");
    return flags;
}

export function eventLabelFor(e: ScheduleEvent): string {
    return formatList(
        [
            e.timeLabel,
            e.headline,
            e.serviceName,
            e.staffName,
            s.statusLabel(e.status),
            ...(e.needsMove ? [s.needsMove] : []),
        ],
        "unit",
    );
}

/** Visits that ended without a Completed or No-show, oldest first. */
export const needsClosing = (events: readonly ScheduleEvent[]): ScheduleEvent[] =>
    events.filter((e) => e.needsClose);

/** The next visits that haven't started, soonest first. */
export const upNext = (events: readonly ScheduleEvent[], now: Date, n = 3): ScheduleEvent[] =>
    events
        .filter((e) => e.start > now && (e.status === "confirmed" || e.status === "pending"))
        .slice(0, n);

interface VisitSubject {
    id: string;
    name: string;
    attributes: Record<string, unknown>;
}

interface DetailClientRow {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    tags: string | null;
}

interface SubjectDetailRow {
    id: string;
    name: string;
    attributes: string | null;
}

interface NoteRow {
    id: string;
    body: string;
}

interface SeriesRow {
    id: string;
    frequency: string;
    interval: number;
    count: number | null;
    position: number;
}

interface RosterRow {
    booking_id: string;
    status: string;
    client_name: string;
    subject_name: string | null;
    deposit_status: string;
}

interface VisitStatsRow {
    visits: number;
    last_visit: string | null;
}

export const DETAIL_CLIENT_SQL = "SELECT id, name, phone, email, tags FROM clients WHERE id = ?";

export const DETAIL_SUBJECT_SQL = `
SELECT sj.id, sj.name, sj.attributes FROM subjects sj
JOIN bookings b ON b.subject_id = sj.id WHERE b.id = ?`;

export const DETAIL_NOTES_SQL = `
SELECT n.id, n.body FROM notes n
WHERE (n.parent_type = 'booking' AND n.parent_id = ?1)
   OR (n.parent_type = 'client' AND n.parent_id = ?2)
   OR (n.parent_type = 'subject' AND n.parent_id IN (SELECT subject_id FROM bookings WHERE id = ?1))
ORDER BY n.created_at DESC`;

export const DETAIL_SERIES_SQL = `
SELECT r.id, r.frequency, r.interval, r.count,
       (SELECT COUNT(*) FROM slots x WHERE x.recurrence_id = r.id AND x.status != 'canceled'
          AND ${utcSql("x.starts_at")} <= ${utcSql("s.starts_at")}) AS position
FROM recurrences r JOIN slots s ON s.recurrence_id = r.id WHERE s.id = ?`;

export const DETAIL_ROSTER_SQL = `
SELECT b.id AS booking_id, b.status, c.name AS client_name, sj.name AS subject_name, b.deposit_status
FROM bookings b JOIN clients c ON c.id = b.client_id
LEFT JOIN subjects sj ON sj.id = b.subject_id
WHERE b.slot_id = ? AND b.status != 'canceled' AND b.deleted_at IS NULL
ORDER BY b.status = 'waitlisted', b.created_at`;

export const VISIT_STATS_SQL = `
SELECT COUNT(*) AS visits, MAX(s.starts_at) AS last_visit
FROM bookings b JOIN slots s ON s.id = b.slot_id
WHERE b.client_id = ? AND b.status = 'completed' AND b.deleted_at IS NULL`;

function subjectOf(row: SubjectDetailRow | undefined): VisitSubject | null {
    if (row === undefined) return null;
    return { id: row.id, name: row.name, attributes: parseAttributes(row.attributes) };
}

function parseTags(raw: string | null): string[] {
    if (raw === null) return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed.filter((t): t is string => typeof t === "string")
            : [];
    } catch {
        return raw
            .replace(/[{}]/g, "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
    }
}

function seriesEvery(frequency: string, interval: number): string {
    return frequency === "week"
        ? s.everyWeeks(interval)
        : frequency === "month"
          ? s.everyMonths(interval)
          : s.everyDays(interval);
}

export const BUSINESS_ADDRESS_SQL =
    "SELECT json_extract(brand, '$.address') AS address FROM businesses LIMIT 1";

export interface BookingDetail {
    event: ScheduleEvent;
    client: DetailClientRow | null;
    clientLine: string;
    subject: VisitSubject | null;
    subjectLine: string | null;
    directions: { address: string; url: string } | null;
    temperament: { label: string; nervous: boolean } | null;
    tags: string[];
    notes: NoteRow[];
    series: string | null;
    depositLine: string | null;
    depositIntent: Intent;
    history: TimelineEntry[];
    timing: string;
    roster: { id: string; name: string; subjectName: string; waiting: boolean; unpaid: boolean }[];
}

function timingLabel(e: ScheduleEvent, now: Date, zone: string): string {
    const toStart = Math.round((e.start.getTime() - now.getTime()) / MIN);
    const toEnd = Math.round((e.end.getTime() - now.getTime()) / MIN);
    if (e.status === "completed") return s.completed;
    if (e.status === "no_show") return s.noShowDone;
    if (e.needsClose) return s.endedAgo;
    if (e.inProgress) return s.endsIn(toEnd);
    if (toStart > 0 && sameDay(e.start, now, zone))
        return s.startsIn(s.timeUntil(Math.floor(toStart / 60), toStart % 60));
    return formatFullDate(e.start, zone);
}

/** Everything the booking panel shows about one visit: client, subject, notes, deposit and history. */
export function useBookingDetail(event: ScheduleEvent | null, now: Date): BookingDetail | null {
    const bookingId = event?.bookingId ?? "";
    const clientId = event?.clientId ?? "";
    const client = useQuery<DetailClientRow>(DETAIL_CLIENT_SQL, [clientId]).data.at(0) ?? null;
    const subject = subjectOf(
        useQuery<SubjectDetailRow>(DETAIL_SUBJECT_SQL, [bookingId]).data.at(0),
    );
    const kind = useSubjectKind();
    const businessAddress =
        useQuery<{ address: string | null }>(BUSINESS_ADDRESS_SQL).data.at(0)?.address ?? null;
    const notes = useQuery<NoteRow>(DETAIL_NOTES_SQL, [bookingId, clientId]).data;
    const series = useQuery<SeriesRow>(DETAIL_SERIES_SQL, [event?.slotId ?? ""]).data.at(0);
    const roster = useQuery<RosterRow>(DETAIL_ROSTER_SQL, [
        event?.kind === "class" ? event.slotId : "",
    ]).data;
    const stats = useQuery<VisitStatsRow>(VISIT_STATS_SQL, [clientId]).data.at(0);
    const zone = useBusinessZone();
    if (event === null) return null;
    const stamp = (d: Date): string => formatShortDayTime(d, zone);
    const amount = formatMoney(event.depositAmountCents, BUSINESS_CURRENCY);
    const depositLine = !event.depositRequired
        ? null
        : event.depositStatus === "collected"
          ? s.depositPaid(amount)
          : event.depositStatus === "applied"
            ? s.depositApplied(amount)
            : event.depositStatus === "forfeited"
              ? s.depositKept(amount)
              : event.depositStatus === "refunded"
                ? s.depositRefunded(amount)
                : s.depositDue(amount);
    const history: TimelineEntry[] = [];
    if (event.bookedAt !== null) {
        history.push({
            key: "booked",
            label: event.source === "online" ? s.historyOnline : s.historyStaff,
            at: stamp(event.bookedAt),
            intent: "accent",
        });
        if (event.depositRequired && event.depositStatus === "pending")
            history.push({
                key: "deposit",
                label: s.historyDepositDue(amount),
                at: stamp(event.bookedAt),
                intent: "warning",
            });
    }
    if (event.depositStatus === "collected" || event.depositStatus === "applied")
        history.push({
            key: "deposit",
            label: s.historyDeposit(amount),
            at: "",
            intent: "success",
        });
    if (event.kind === "visit" && event.status !== "completed" && event.status !== "no_show") {
        const due = new Date(event.start.getTime() - 24 * 60 * MIN);
        history.push({
            key: "reminder",
            label: event.remindedAt !== null ? s.historyReminderSent : s.historyReminderDue,
            at: stamp(event.remindedAt ?? due),
            intent: "neutral",
        });
    }
    if (event.departedAt !== null)
        history.push({
            key: "departed",
            label: s.historyDeparted(event.staffShort),
            at: stamp(event.departedAt),
            intent: "accent",
        });
    if (event.checkedIn)
        history.push({
            key: "here",
            label: kind === "site" ? s.historyArrived : s.historyCheckedIn,
            at: "",
            intent: "accent",
        });
    if (event.status === "completed")
        history.push({ key: "done", label: s.completed, at: stamp(event.end), intent: "success" });
    if (event.status === "no_show")
        history.push({
            key: "done",
            label: s.noShowDone,
            at: stamp(event.start),
            intent: "danger",
        });
    const address =
        event.kind === "visit"
            ? visitAddress(kind, subject?.attributes ?? null, businessAddress)
            : null;
    const visits = stats?.visits ?? 0;
    const last = stats?.last_visit ? parseTimestamp(stats.last_visit) : null;
    return {
        event,
        client,
        clientLine: formatParts([
            client?.phone ? formatPhone(client.phone) : null,
            visits > 0 ? s.visitsCount(visits) : s.firstVisit,
            last !== null ? s.lastVisit(formatDate(last, zone)) : null,
        ]),
        subject,
        directions: address === null ? null : { address, url: mapsUrl(address) },
        subjectLine:
            subject === null ? null : subjectSummary(kind, subject.attributes, zone, now) || null,
        temperament: subject === null ? null : subjectTemperament(kind, subject.attributes),
        tags: parseTags(client?.tags ?? null),
        notes,
        series: series
            ? series.count === null
                ? s.seriesLabelOpen(series.position, seriesEvery(series.frequency, series.interval))
                : s.seriesLabel(
                      series.position,
                      series.count,
                      seriesEvery(series.frequency, series.interval),
                  )
            : null,
        depositLine,
        depositIntent:
            event.depositStatus === "collected" || event.depositStatus === "applied"
                ? "success"
                : event.depositStatus === "forfeited"
                  ? "danger"
                  : event.depositStatus === "refunded"
                    ? "neutral"
                    : "warning",
        history,
        timing: timingLabel(event, now, zone),
        roster: roster.map((r) => ({
            id: r.booking_id,
            name: r.client_name,
            subjectName: r.subject_name ?? "",
            waiting: r.status === "waitlisted",
            unpaid: r.deposit_status === "pending",
        })),
    };
}

export type LifecycleAction = "complete" | "no_show" | "cancel";

export interface BookingActions {
    canComplete: boolean;
    canNoShow: boolean;
    canCancel: boolean;
    canReschedule: boolean;
    pending: LifecycleAction | null;
    busy: boolean;
    error: string | null;
    noShowNote: string;
    cancelNote: string;
    notStartedNote: string | null;
    run: (action: LifecycleAction) => void;
}

/** Completed and No-show once a visit has started; Cancel and Reschedule while it's still ahead. */
export function lifecycleOf(
    event: ScheduleEvent | null,
    now: Date,
): Pick<
    BookingActions,
    "canComplete" | "canNoShow" | "canCancel" | "canReschedule" | "notStartedNote"
> {
    const open =
        event !== null &&
        event.bookingId !== null &&
        (event.status === "confirmed" || event.status === "pending");
    const started = event !== null && event.start <= now;
    return {
        canComplete: open && started,
        canNoShow: open && started,
        canCancel: open && !started,
        canReschedule: open && !started,
        notStartedNote: open && !started ? s.notStartedNote : null,
    };
}

export function useBookingActions(
    api: ApiLike,
    event: ScheduleEvent | null,
    now: Date,
    onDone?: (action: LifecycleAction) => void,
): BookingActions {
    const { busy, error, run } = useAsyncAction();
    const [pending, setPending] = useState<LifecycleAction | null>(null);
    const amount = formatMoney(event?.depositAmountCents ?? 0, BUSINESS_CURRENCY);
    const paid = event !== null && event.depositRequired && event.depositStatus === "collected";
    const due = event !== null && event.depositRequired && event.depositStatus === "pending";
    return {
        ...lifecycleOf(event, now),
        pending: busy ? pending : null,
        busy,
        error,
        noShowNote: paid ? s.noShowKeep(amount) : due ? s.noShowCharge(amount) : s.noShowNoDeposit,
        cancelNote: paid ? s.cancelKept(amount) : s.cancelNotify,
        run: (action) => {
            if (event?.bookingId == null) return;
            const bookingId = event.bookingId;
            const status =
                action === "complete" ? "completed" : action === "no_show" ? "no_show" : "canceled";
            setPending(action);
            run(() => api.patch(`/v1/bookings/${bookingId}`, { status }), {
                onSuccess: () => {
                    onDone?.(action);
                },
                errorMessage: (e) => failureMessage(e, s.actionError),
            });
        },
    };
}

export interface ComposerSlot {
    staffId: string;
    start: Date;
    // an accepted estimate to book: its client is picked and its products join as add-ons
    estimateId?: string | undefined;
    // a visit just checked out: its client, service and member are picked at the usual interval
    rebookId?: string | undefined;
}

const NEXT_VISIT_SQL = `
SELECT b.client_id, b.subject_id, s.item_id, s.staff_id, s.starts_at, r.frequency, r.interval,
       (SELECT ps.starts_at FROM bookings pb JOIN slots ps ON ps.id = pb.slot_id
        WHERE pb.client_id = b.client_id AND ps.item_id = s.item_id AND pb.id != b.id
          AND pb.status = 'completed' AND pb.deleted_at IS NULL
          AND ${utcSql("ps.starts_at")} < ${utcSql("s.starts_at")}
        ORDER BY ${utcSql("ps.starts_at")} DESC LIMIT 1) AS previous_at
FROM bookings b JOIN slots s ON s.id = b.slot_id
LEFT JOIN recurrences r ON r.id = s.recurrence_id
WHERE b.id = ?`;

interface NextVisitRow {
    client_id: string;
    subject_id: string | null;
    item_id: string;
    staff_id: string;
    starts_at: string;
    frequency: string | null;
    interval: number | null;
    previous_at: string | null;
}

/** The next visit at the series' interval, or the client's own gap between their last two. */
export function nextVisitStart(
    start: Date,
    previous: Date | null,
    series: { frequency: string; interval: number } | null,
    zone: string,
): Date | null {
    const at = (day: Date): Date =>
        combineDayAndTime(dateKey(day, zone), clockKey(start, zone), zone);
    if (series !== null) {
        if (series.frequency === "month") return at(addMonths(start, series.interval, zone));
        return at(addDays(start, series.interval * (series.frequency === "week" ? 7 : 1), zone));
    }
    if (previous === null) return null;
    const days = Math.round((+start - +previous) / (24 * 60 * MIN));
    return days >= 1 ? at(addDays(start, days, zone)) : null;
}

interface NextVisit {
    clientId: string;
    subjectId: string | null;
    itemId: string;
    staffId: string;
    start: Date | null;
}

/** What booking again after this visit looks like: same client, service and member. */
export function useNextVisit(bookingId: string | null): NextVisit | null {
    const zone = useBusinessZone();
    const row = useQuery<NextVisitRow>(NEXT_VISIT_SQL, [bookingId ?? ""]).data[0];
    return useMemo(() => {
        if (row === undefined) return null;
        const series =
            row.frequency === null || row.interval === null
                ? null
                : { frequency: row.frequency, interval: row.interval };
        return {
            clientId: row.client_id,
            subjectId: row.subject_id,
            itemId: row.item_id,
            staffId: row.staff_id,
            start: nextVisitStart(
                parseTimestamp(row.starts_at),
                row.previous_at === null ? null : parseTimestamp(row.previous_at),
                series,
                zone,
            ),
        };
    }, [row, zone]);
}

export const ESTIMATE_BOOKING_SQL = `
SELECT e.client_id, e.number FROM estimates e
WHERE e.id = ? AND e.status = 'accepted' AND e.converted_invoice_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.estimate_id = e.id AND b.status != 'canceled' AND b.deleted_at IS NULL)`;

export const ESTIMATE_PRODUCTS_SQL = `
SELECT l.id, l.description, l.quantity FROM lines l JOIN items i ON i.id = l.item_id
WHERE l.estimate_id = ? AND i.kind = 'product' AND (COALESCE(l.optional, 0) = 0 OR l.selected = 1)
ORDER BY l.position, l.id`;

interface SubjectOption {
    id: string;
    client_id: string;
    name: string;
}

export const CLIENT_SUBJECT_OPTIONS_SQL =
    "SELECT id, client_id, name FROM subjects WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE";

const pad = (n: number): string => String(n).padStart(2, "0");

/** Quarter-hour starts for the composer's time menu, across the usual day and the board's visible window. */
export function composerTimes(window: VisibleWindow): { key: string; label: string }[] {
    const out: { key: string; label: string }[] = [];
    for (let hh = Math.min(6, window.startHour); hh < Math.max(22, window.endHour); hh++)
        for (const mm of [0, 15, 30, 45]) {
            const key = `${pad(hh)}:${pad(mm)}`;
            out.push({ key, label: formatClock(key) });
        }
    return out;
}

export interface BookingComposer {
    query: string;
    setQuery: (q: string) => void;
    matches: { client: ClientRow; subjects: string[] }[];
    client: ClientRow | null;
    pickClient: (id: string | null) => void;
    kind: SubjectKind | null;
    subjects: SubjectOption[];
    subjectId: string;
    setSubjectId: (id: string) => void;
    services: ItemRow[];
    item: ItemRow | null;
    setItemId: (id: string) => void;
    staffId: string;
    setStaffId: (id: string) => void;
    staffOptions: { id: string; name: string; free: boolean; media: OptionMedia }[];
    day: string;
    setDay: (key: string) => void;
    time: string;
    setTime: (hhmm: string) => void;
    endsLabel: string;
    // the estimate being booked and the products it adds, which a series can't carry
    fromEstimate: { title: string; lines: string[] } | null;
    repeat: boolean;
    setRepeat: (v: boolean) => void;
    every: number;
    setEvery: (n: number) => void;
    count: number;
    setCount: (n: number) => void;
    note: string;
    setNote: (v: string) => void;
    notify: boolean;
    setNotify: (v: boolean) => void;
    depositLine: string | null;
    problem: string | null;
    notice: string | null;
    canSubmit: boolean;
    submit: () => void;
    busy: boolean;
    error: string | null;
    timeOptions: { key: string; label: string }[];
    // The chosen member's week and open starts for the service length, for a phone's slot picker.
    days: WeekStripDay[];
    slotGroups: { label: string; slots: { key: string; label: string; disabled?: boolean }[] }[];
    // the visit being booked, drawn on the calendar until it's booked or closed
    draft: BookingDraft | null;
    // moves the draft to a member and start, snapped to the quarter hour the time menu offers
    place: (staffId: string, at: Date) => void;
}

export interface BookingDraft {
    staffId: string;
    start: Date;
    end: Date;
    headline: string;
    detail: string | undefined;
    timeLabel: string;
    startLabel: string;
    problem: string | null;
    label: string;
}

interface VisibleWindow {
    startHour: number;
    endHour: number;
}

// Where a member with no hours set is offered times when the board has no window to follow.
const USUAL_DAY: VisibleWindow = { startHour: 8, endHour: 18 };

/** Every quarter-hour start that fits the member's hours on a day, or the window when none are set. */
export function openStarts(
    avail: Availability,
    staffId: string,
    day: Date,
    length: number,
    window: VisibleWindow,
): Date[] {
    const zone = avail.zone;
    const windows = avail.windows(staffId, day) ?? [
        {
            start: minutesInto(day, window.startHour * 60, zone),
            end: minutesInto(day, window.endHour * 60, zone),
        },
    ];
    const out: Date[] = [];
    for (const w of windows)
        for (let t = w.start.getTime(); t + length * MIN <= w.end.getTime(); t += 15 * MIN)
            out.push(new Date(t));
    return out;
}

interface SlotGroup {
    label: string;
    slots: { key: string; label: string; disabled?: boolean }[];
}

function groupStarts(
    slots: { key: string; at: Date; disabled: boolean }[],
    zone: string,
): SlotGroup[] {
    const part = (label: string, from: number, to: number): SlotGroup => ({
        label,
        slots: slots
            .filter((x) => {
                const hour = wallTime(x.at, zone).hour;
                return hour >= from && hour < to;
            })
            .map((x) => ({
                key: x.key,
                label: formatTimeOfPeriod(x.at, zone),
                disabled: x.disabled,
            })),
    });
    return [part(s.morning, 0, 12), part(s.afternoon, 12, 17), part(s.evening, 17, 24)].filter(
        (g) => g.slots.length > 0,
    );
}

/** The same weekday a week on or back, held to today so a week change never lands in the past. */
export function shiftDay(day: string, dir: 1 | -1, zone: string, now: Date): string {
    const next = addDays(combineDayAndTime(day, "00:00", zone), dir * 7, zone);
    const today = startOfDay(now, zone);
    return dateKey(next < today ? today : next, zone);
}

/** The members a viewer can book for: everyone for an owner or admin, otherwise only themselves. */
export function actorsFor(rows: StaffRow[], viewer: Viewer | null): StaffRow[] {
    if (viewer === null || canManagePayments(viewer.role)) return rows;
    return rows.filter((x) => x.id === viewer.staffId);
}

export function depositOf(item: ItemRow | null): number {
    if (item === null || item.deposit_type === "none" || item.deposit_value === null) return 0;
    return item.deposit_type === "fixed"
        ? item.deposit_value
        : Math.round(((item.price_cents ?? 0) * item.deposit_value) / 100);
}

/** After the form's day or the board's day changes, which one catches up: the board, the form, or neither. */
export function draftFollows(
    was: { focus: string; day: string } | null,
    day: string,
    focus: string,
): "board" | "form" | null {
    if (day === focus) return null;
    if (day !== was?.day) return "board";
    return focus !== was.focus ? "form" : null;
}

/** Where New booking first puts the visit: the next quarter hour on today, otherwise ten in the morning. */
export function suggestedStart(day: Date, now: Date, zone: string): Date {
    if (!sameDay(day, now, zone)) return minutesInto(day, 10 * 60, zone);
    return new Date(Math.ceil(+now / (15 * MIN)) * 15 * MIN);
}

/** The nearest quarter hour, the steps the composer's time menu offers. */
export function toQuarterHour(at: Date): Date {
    return new Date(Math.round(+at / (15 * MIN)) * 15 * MIN);
}

/** The new-booking form for the open slot, reset when another opens; its day and the board's move together. */
export function useBookingComposer(
    api: ApiLike,
    slot: ComposerSlot | null,
    board: {
        actors: StaffRow[];
        window: VisibleWindow;
        focus: { key: string };
        setAnchor: (day: Date) => void;
    },
    onCreated: () => void,
): BookingComposer {
    const photos = usePeoplePhotos();
    const clients = useClients();
    const kind = useSubjectKind();
    const allSubjects = useQuery<SubjectOption>(CLIENT_SUBJECT_OPTIONS_SQL).data;
    const services = bookableItems(useCatalogItems());
    const [query, setQuery] = useState("");
    const [clientId, setClientId] = useState<string | null>(null);
    const [subjectId, setSubjectId] = useState("");
    const estimateId = slot?.estimateId ?? "";
    const estimate =
        useQuery<{ client_id: string; number: number | null }>(ESTIMATE_BOOKING_SQL, [estimateId])
            .data[0] ?? null;
    const products = useQuery<{ id: string; description: string; quantity: number }>(
        ESTIMATE_PRODUCTS_SQL,
        [estimateId],
    ).data;
    const [itemId, setItemId] = useState("");
    const zone = useBusinessZone();
    const [staffId, setStaffId] = useState(slot?.staffId ?? "");
    const [day, setDay] = useState(dateKey(slot?.start ?? new Date(), zone));
    const [time, setTime] = useState(clockKey(slot?.start ?? new Date(), zone));
    const [repeat, setRepeat] = useState(false);
    const [every, setEvery] = useState(4);
    const [count, setCount] = useState(6);
    const [note, setNote] = useState("");
    const [notify, setNotify] = useState(true);
    const [notice, setNotice] = useState<string | null>(null);
    const { busy, error, setError, run } = useAsyncAction();
    const key = useRef<Attempt | null>(null);

    const item = services.find((i) => i.id === itemId) ?? null;
    const client = clients.find((c) => c.id === clientId) ?? null;
    const start = combineDayAndTime(day, time, zone);
    const weekStart = startOfWeek(start, zone);
    const weekEnd = addDays(weekStart, 7, zone);
    const { events } = useScheduleEvents(weekStart, weekEnd);
    const avail = useAvailability(weekStart, weekEnd);
    const staff = useActiveStaff().byId;
    const length = item?.duration_min ?? 60;
    const end = new Date(start.getTime() + length * MIN);
    const q = query.trim().toLowerCase();
    const subjectsOf = (id: string): SubjectOption[] =>
        kind === null ? [] : allSubjects.filter((p) => p.client_id === id);
    const matches = clients
        .filter((c) => c.status === "active")
        .map((c) => ({ client: c, subjects: subjectsOf(c.id).map((p) => p.name) }))
        .filter(
            (x) =>
                q === "" ||
                [x.client.name, x.client.phone ?? "", ...x.subjects].some((v) =>
                    v.toLowerCase().includes(q),
                ),
        )
        .slice(0, 6);
    const now = new Date();
    const target = { item: item === null ? null : slotItemOf(item) };
    const check = (who: string, at = start): { problem: MoveProblem; message: string } =>
        at < now
            ? { problem: "past", message: s.problemPast }
            : slotProblem(
                  avail,
                  events,
                  staff,
                  who,
                  at,
                  new Date(+at + length * MIN),
                  null,
                  target,
              );
    const next = useNextVisit(slot?.rebookId ?? null);
    const rebooked = useRef(false);
    const prefilled = useRef(false);
    const opened = useRef(slot);
    // a member the form suggested rather than one picked, so it may follow the hours once they load
    const auto = useRef(false);
    const picked = useRef(false);
    useEffect(() => {
        if (opened.current === slot) return;
        opened.current = slot;
        if (slot === null) return;
        auto.current = false;
        picked.current = false;
        rebooked.current = false;
        prefilled.current = false;
        key.current = null;
        setStaffId(slot.staffId);
        setDay(dateKey(slot.start, zone));
        setTime(clockKey(slot.start, zone));
        setQuery("");
        setClientId(null);
        setSubjectId("");
        setItemId("");
        setRepeat(false);
        setNote("");
        setNotify(true);
        setNotice(null);
        setError(null);
    }, [slot, zone, setError]);
    const { key: focusKey } = board.focus;
    const { setAnchor } = board;
    const synced = useRef<{ focus: string; day: string } | null>(null);
    useEffect(() => {
        const was = synced.current;
        synced.current = slot === null ? null : { focus: focusKey, day };
        if (slot === null) return;
        const follow = draftFollows(was, day, focusKey);
        if (follow === "board") setAnchor(combineDayAndTime(day, "12:00", zone));
        else if (follow === "form") setDay(focusKey);
    }, [slot, day, focusKey, setAnchor, zone]);
    useEffect(() => {
        if (rebooked.current || next === null || services.length === 0) return;
        rebooked.current = true;
        setClientId(next.clientId);
        setSubjectId(next.subjectId ?? "");
        if (services.some((i) => i.id === next.itemId)) setItemId(next.itemId);
        if (board.actors.some((a) => a.id === next.staffId)) {
            picked.current = true;
            setStaffId(next.staffId);
        }
        if (next.start !== null) {
            setDay(dateKey(next.start, zone));
            setTime(clockKey(next.start, zone));
        }
    }, [next, zone, services, board.actors]);
    useEffect(() => {
        if (prefilled.current || estimate === null) return;
        prefilled.current = true;
        setClientId(estimate.client_id);
        setSubjectId(
            kind === null
                ? ""
                : (allSubjects.find((p) => p.client_id === estimate.client_id)?.id ?? ""),
        );
    }, [estimate, kind, allSubjects]);
    const fallback = (
        board.actors.find((a) => avail.hours(a.id, start) !== null) ?? board.actors[0]
    )?.id;
    const known = board.actors.some((a) => a.id === staffId);
    useEffect(() => {
        if (slot === null || fallback === undefined || picked.current) return;
        if (!known || auto.current) {
            auto.current = true;
            setStaffId(fallback);
        }
    }, [slot, known, fallback]);
    const booking = estimate !== null && client?.id === estimate.client_id;
    const verdict = check(staffId);
    const problem = item !== null && verdict.problem !== null ? verdict.message : null;
    const deposit = depositOf(item);
    const member = staff.get(staffId);
    const subjectName = allSubjects.find((p) => p.id === subjectId)?.name ?? null;
    const timeLabel = formatTimeRange(start, end, zone);
    const draftProblem = verdict.problem === null ? null : verdict.message;

    return {
        query,
        setQuery,
        matches,
        client,
        pickClient: (id) => {
            setClientId(id);
            setSubjectId(id === null ? "" : (subjectsOf(id).at(0)?.id ?? ""));
            setQuery("");
        },
        kind,
        subjects: client ? subjectsOf(client.id) : [],
        subjectId,
        setSubjectId,
        services,
        item,
        setItemId,
        staffId,
        setStaffId: (id) => {
            picked.current = true;
            setStaffId(id);
        },
        staffOptions: board.actors.map((x) => ({
            id: x.id,
            name: staffName(x),
            free: check(x.id).problem === null,
            media: personMedia(staffName(x), x.color, photos.staff(x.id)),
        })),
        day,
        setDay,
        time,
        setTime,
        endsLabel: s.composerEnds(formatTime(end, zone), length),
        fromEstimate: booking
            ? {
                  title: s.composerFromEstimate(estimate.number ?? 0),
                  lines: products.map((l) => strings.common.quantityOf(l.quantity, l.description)),
              }
            : null,
        repeat: repeat && !booking,
        setRepeat,
        every,
        setEvery,
        count,
        setCount,
        note,
        setNote,
        notify,
        setNotify,
        depositLine:
            deposit > 0 ? s.composerDeposit(formatMoney(deposit, BUSINESS_CURRENCY)) : null,
        problem,
        notice,
        canSubmit: client !== null && item !== null && problem === null,
        submit: () => {
            if (client === null || item === null) {
                setError(s.composerIncomplete);
                return;
            }
            const body = {
                client_id: client.id,
                subject_id: subjectId === "" ? null : subjectId,
                item_id: item.id,
                staff_id: staffId,
                starts_at: start.toISOString(),
                ...(booking ? { estimate_id: estimateId } : {}),
            };
            const idempotencyKey = attemptKey(key, { body, repeat, every, count, notify, note });
            let skipped = 0;
            let created = 0;
            run(
                async () => {
                    if (repeat && !booking) {
                        const out = await api.post<{ created: number; skipped: number }>(
                            "/v1/recurrences",
                            {
                                ...body,
                                frequency: "week",
                                interval: every,
                                count,
                                confirmation: notify ? "series" : "none",
                            },
                            { idempotencyKey },
                        );
                        created = out.created;
                        skipped = out.skipped;
                    } else {
                        await api.post(
                            "/v1/bookings",
                            { ...body, note: note.trim() || null, notify },
                            { idempotencyKey },
                        );
                    }
                },
                {
                    onSuccess: () => {
                        key.current = null;
                        if (skipped > 0) setNotice(s.composerSeriesSkipped(created, skipped));
                        else onCreated();
                    },
                    errorMessage: (e) => failureMessage(e, s.composerError),
                },
            );
        },
        busy,
        error,
        timeOptions: composerTimes(board.window),
        days: weekStrip(
            start,
            events.filter((e) => e.staffId === staffId),
            avail,
            now,
        ).map((x) => ({
            ...x,
            disabled:
                addDays(x.date, 1, zone) <= now ||
                avail.isClosed(x.date) !== null ||
                (avail.windows(staffId, x.date)?.length ?? 1) === 0,
        })),
        slotGroups: groupStarts(
            openStarts(avail, staffId, startOfDay(start, zone), length, board.window)
                .filter((at) => at >= now)
                .map((at) => ({
                    key: clockKey(at, zone),
                    at,
                    disabled: check(staffId, at).problem !== null,
                })),
            zone,
        ),
        draft:
            slot === null
                ? null
                : {
                      staffId,
                      start,
                      end,
                      headline:
                          client === null ? s.newBooking : formatParts([subjectName, client.name]),
                      detail: item?.name,
                      timeLabel,
                      startLabel: formatTime(start, zone),
                      problem: draftProblem,
                      label: s.draftLabel(
                          timeLabel,
                          member === undefined ? "" : staffName(member),
                          draftProblem ?? "",
                      ),
                  },
        place: (who, at) => {
            const snapped = toQuarterHour(at);
            if (board.actors.some((a) => a.id === who)) {
                picked.current = true;
                setStaffId(who);
            }
            setDay(dateKey(snapped, zone));
            setTime(clockKey(snapped, zone));
        },
    };
}

interface Reschedule {
    days: WeekStripDay[];
    day: string;
    setDay: (key: string) => void;
    staffId: string;
    setStaffId: (id: string) => void;
    staffOptions: { key: string; label: string; media: OptionMedia }[];
    groups: SlotGroup[];
    open: number;
    loading: boolean;
    value: string | null;
    setValue: (key: string) => void;
    target: string | null;
    submit: () => void;
    busy: boolean;
    error: string | null;
    shiftWeek: (dir: 1 | -1) => void;
}

/** Free starts every 15 minutes for one person and day, checked the same way a drag is. */
export function useReschedule(
    api: ApiLike,
    event: ScheduleEvent,
    viewer: Viewer | null,
    onDone: () => void,
): Reschedule {
    const photos = usePeoplePhotos();
    const now = useNow();
    const zone = useBusinessZone();
    const first = event.start < now ? now : event.start;
    const [day, setDay] = useState(dateKey(first, zone));
    const [staffId, setStaffId] = useState(event.staffId);
    const [value, setValue] = useState<string | null>(null);
    const { busy, error, run } = useAsyncAction();
    const date = combineDayAndTime(day, "00:00", zone);
    const weekStart = startOfWeek(date, zone);
    const weekEnd = addDays(weekStart, 7, zone);
    const week = useScheduleEvents(weekStart, weekEnd);
    const avail = useAvailability(weekStart, weekEnd);
    const staff = useActiveStaff();
    const length = (event.end.getTime() - event.start.getTime()) / MIN;
    const ctx = { avail, events: week.events, staff: staff.byId };
    const slots = openStarts(avail, staffId, date, length, USUAL_DAY)
        .filter((at) => at >= now)
        .map((at) => {
            const plan = planMove(event, (+at - +event.start) / MIN, staffId, ctx, now);
            const same = +at === +event.start && staffId === event.staffId;
            return { key: at.toISOString(), at, disabled: plan.problem !== null || same };
        });
    const picked = value !== null ? new Date(value) : null;
    return {
        days: weekStrip(
            date,
            week.events.filter((e) => e.staffId === staffId),
            avail,
            now,
        ).map((x) => ({
            ...x,
            disabled:
                addDays(x.date, 1, zone) <= now ||
                avail.isClosed(x.date) !== null ||
                (avail.windows(staffId, x.date)?.length ?? 1) === 0,
        })),
        day,
        setDay: (k) => {
            setDay(k);
            setValue(null);
        },
        staffId,
        setStaffId: (id) => {
            setStaffId(id);
            setValue(null);
        },
        staffOptions: actorsFor(staff.rows, viewer).map((x) => ({
            key: x.id,
            label: firstName(staffName(x)),
            media: personMedia(staffName(x), x.color, photos.staff(x.id)),
        })),
        groups: groupStarts(slots, zone),
        open: slots.filter((x) => !x.disabled).length,
        loading: week.isLoading || avail.sources.some((x) => x.isLoading),
        value,
        setValue,
        target: picked ? formatDayTime(picked, zone) : null,
        submit: () => {
            if (picked === null || event.bookingId === null) return;
            const bookingId = event.bookingId;
            run(
                () =>
                    api.patch(`/v1/bookings/${bookingId}`, {
                        starts_at: picked.toISOString(),
                        staff_id: staffId,
                    }),
                { onSuccess: onDone, errorMessage: moveFailure },
            );
        },
        busy,
        error,
        shiftWeek: (dir) => {
            setDay((d) => shiftDay(d, dir, zone, now));
            setValue(null);
        },
    };
}

interface DepositResult {
    booking_id: string;
    payment_id: string;
    client_secret: string;
}

/** A deposit can be collected while it's still due, by an owner/admin or the booking's own staff. */
export function canCollectDeposit(event: CalendarEvent, viewer: Viewer | null): boolean {
    const canAct =
        viewer !== null && (canManagePayments(viewer.role) || viewer.staffId === event.staffId);
    return (
        canAct &&
        event.bookingId !== null &&
        event.depositRequired &&
        event.depositStatus === "pending"
    );
}

interface CollectDeposit {
    checkout: Checkout;
    submit: () => void;
    // a collected deposit whose booking has not reached this device yet
    settling: Arrival;
}

/** A saved method charges now; otherwise the platform card form confirms the returned client secret. */
export function useCollectDeposit(
    api: ApiLike,
    event: CalendarEvent,
    onDone: () => void,
    defaultMethod?: string,
): CollectDeposit {
    const key = event.bookingId === null ? null : `booking-deposit:${event.bookingId}`;
    const settling = useArrival(key, event.depositStatus === "pending" ? 0 : 1);
    const collected = (): void => {
        if (key !== null) expectArrival(key, (current) => current > 0);
        onDone();
    };
    const checkout = useCheckout(collected, defaultMethod !== undefined ? { defaultMethod } : {});
    const submit = (): void => {
        const bookingId = event.bookingId;
        if (bookingId === null) return;
        checkout.pay(
            ({ paymentMethodId, idempotencyKey }) => {
                const query =
                    paymentMethodId !== undefined && paymentMethodId !== ""
                        ? `?payment_method_id=${encodeURIComponent(paymentMethodId)}`
                        : "";
                return api.post<DepositResult>(
                    `/v1/bookings/${bookingId}/deposit${query}`,
                    {},
                    { idempotencyKey },
                );
            },
            s.collectDepositError,
            bookingId,
        );
    };
    return { checkout, submit, settling };
}

interface BookingAddonRow {
    id: string;
    description: string;
    quantity: number;
    unit_amount_cents: number;
}

export const ADDONS_SQL = `
SELECT id, description, quantity, unit_amount_cents FROM addons
WHERE booking_id = ? ORDER BY created_at`;

export const BOOKING_INVOICE_SQL = "SELECT invoice_id FROM bookings WHERE id = ?";

interface BookingAddons {
    addons: BookingAddonRow[];
    totalCents: number;
    invoiceId: string | null;
    canEdit: boolean;
    canInvoice: boolean;
    remove: (addonId: string) => void;
    createInvoice: () => void;
    busy: boolean;
    error: string | null;
}

/** Staff can remove add-ons until the visit is invoiced; an owner or admin invoices them as lines. */
export function useBookingAddons(
    api: ApiLike,
    event: CalendarEvent,
    viewer: Viewer | null,
): BookingAddons {
    const bookingId = event.bookingId ?? "";
    const addons = useQuery<BookingAddonRow>(ADDONS_SQL, [bookingId]).data;
    const invoiceId =
        useQuery<{ invoice_id: string | null }>(BOOKING_INVOICE_SQL, [bookingId]).data.at(0)
            ?.invoice_id ?? null;
    const { busy, error, run } = useAsyncAction();
    const key = useRef<Attempt | null>(null);
    const admin = viewer !== null && canManagePayments(viewer.role);
    const open = invoiceId === null && event.status !== "canceled";
    return {
        addons,
        totalCents: addons.reduce((sum, a) => sum + a.quantity * a.unit_amount_cents, 0),
        invoiceId,
        canEdit: open && (admin || viewer?.staffId === event.staffId),
        canInvoice: open && admin,
        remove: (addonId) => {
            run(() => api.delete(`/v1/bookings/${bookingId}/addons/${addonId}`), {
                errorMessage: s.addonRemoveError,
            });
        },
        createInvoice: () => {
            const idempotencyKey = attemptKey(key, bookingId);
            run(() => api.post(`/v1/invoices/from-booking/${bookingId}`, {}, { idempotencyKey }), {
                errorMessage: s.invoiceVisitError,
            });
        },
        busy,
        error,
    };
}

export const BOOKING_PHOTOS_SQL = `
SELECT id, shared_at FROM files
WHERE parent_type = 'booking' AND parent_id = ? AND uploaded_at IS NOT NULL
ORDER BY created_at, id`;

export interface BookingPhotos {
    // shared photos show on the client's visit page; the rest stay inside the business
    photos: (Photo & { shared: boolean })[];
    canAdd: boolean;
    sharing: string | null;
    share: (fileId: string, shared: boolean) => void;
    busy: boolean;
    error: string | null;
    add: (body: Blob, contentType: string, sizeBytes?: number) => void;
}

/** Before and after photos on a visit; the member on it or a manager can add more. */
export function useBookingPhotos(
    api: ApiLike,
    event: CalendarEvent,
    viewer: Viewer | null,
): BookingPhotos {
    const bookingId = event.bookingId ?? "";
    const rows = useQuery<{ id: string; shared_at: string | null }>(BOOKING_PHOTOS_SQL, [
        bookingId,
    ]).data;
    const sharing = useAsyncAction();
    const [sharingId, setSharingId] = useState<string | null>(null);
    const links = useFileLinks(
        api,
        rows.map((r) => r.id),
    );
    const upload = useFileUpload(api);
    const canAdd =
        bookingId !== "" &&
        viewer !== null &&
        (canManagePayments(viewer.role) || viewer.staffId === event.staffId);
    return {
        photos: rows.map((r) => ({
            id: r.id,
            src: links[r.id] ?? null,
            shared: r.shared_at !== null,
        })),
        canAdd,
        sharing: sharing.busy ? sharingId : null,
        share: (fileId, shared) => {
            if (!canAdd) return;
            setSharingId(fileId);
            sharing.run(() => api.post(`/v1/files/${fileId}/share`, { shared }), {
                errorMessage: (e) => failureMessage(e, s.photoShareError),
            });
        },
        busy: upload.busy,
        error: upload.error ?? sharing.error,
        add: (body, contentType, sizeBytes) => {
            if (!canAdd) return;
            upload.upload(body, bookingPhotoTarget(bookingId), contentType, sizeBytes);
        },
    };
}

/** Where a visit stands on the way in, for businesses that go to the client's place. */
export function arrivalLabel(event: ScheduleEvent, kind: SubjectKind | null): string | null {
    if (!isPlace(kind) || event.kind !== "visit") return null;
    if (event.checkedIn) return kind === "site" ? s.arrivedOnSite : s.arrivedAtPlace;
    if (event.departedAt !== null && (event.status === "confirmed" || event.status === "pending"))
        return s.onTheWay;
    return null;
}

export interface Departure {
    canDepart: boolean;
    busy: boolean;
    error: string | null;
    depart: () => void;
}

/** "On my way": the member on the visit, or a manager, tells the client they have set off. */
export function useDeparture(
    api: ApiLike,
    event: ScheduleEvent,
    viewer: Viewer | null,
    kind: SubjectKind | null,
): Departure {
    const { busy, error, run } = useAsyncAction();
    const open = event.status === "confirmed" || event.status === "pending";
    const canDepart =
        isPlace(kind) &&
        event.kind === "visit" &&
        event.bookingId !== null &&
        open &&
        event.departedAt === null &&
        !event.checkedIn &&
        viewer !== null &&
        (canManagePayments(viewer.role) || viewer.staffId === event.staffId);
    return {
        canDepart,
        busy,
        error,
        depart: () => {
            if (!canDepart || event.bookingId === null) return;
            const bookingId = event.bookingId;
            run(() => api.post(`/v1/bookings/${bookingId}/depart`, {}), {
                errorMessage: (e) => failureMessage(e, s.departError),
            });
        },
    };
}
