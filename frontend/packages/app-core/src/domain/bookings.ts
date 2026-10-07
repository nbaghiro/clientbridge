import { useQuery } from "@powersync/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { type ApiLike, newIdempotencyKey } from "../api";
import {
    addDays,
    dateKey,
    formatDate,
    formatFullDate,
    formatTime,
    formatWeekday,
    parseTimestamp,
    sameDay,
    startOfDay,
    startOfWeek,
} from "../datetime";
import { firstName, formatMoney, formatPhone, initials } from "../format";
import { type Load, useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { CalendarEventFlag, Intent, TimelineEntry } from "../ui";
import type { Viewer } from "./auth";
import { type ItemRow, bookableItems, useCatalogItems } from "./catalog";
import { type Checkout, useCheckout } from "./checkout";
import { type ClientRow, useClients } from "./clients";
import { canManagePayments } from "./payments";
import { type StaffRow, staffName, useStaff } from "./staff";
import { useReplicaLoad } from "./sync";

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

interface LayoutOptions {
    dayStart: Date;
    pxPerMin: number;
    minHeightPx?: number;
    gapPx?: number;
}

function compareEventStart(a: CalendarEvent, b: CalendarEvent): number {
    return a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime();
}

// Overlapping events chain into a group, then split into first-fit columns so none visually overlap.
function layoutDay(events: CalendarEvent[], opts: LayoutOptions): PositionedEvent[] {
    const { dayStart, pxPerMin, minHeightPx = 18, gapPx = 1 } = opts;
    const dayEnd = addDays(dayStart, 1);
    const dayStartMs = dayStart.getTime();
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
            const startMin = Math.max(0, (e.start.getTime() - dayStartMs) / MIN);
            const endMin = Math.min(1440, (e.end.getTime() - dayStartMs) / MIN);
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
export function utcSql(column: string): string {
    return `datetime(CASE WHEN ${column} LIKE '%+__' THEN ${column} || ':00' ELSE ${column} END)`;
}

type EventSource = "online" | "staff";

const omitKey = <T>(rec: Record<string, T>, key: string): Record<string, T> =>
    Object.fromEntries(Object.entries(rec).filter(([k]) => k !== key));

export interface ScheduleEvent extends CalendarEvent {
    kind: "visit" | "class";
    itemId: string;
    priceCents: number;
    serviceName: string;
    clientName: string | null;
    petName: string | null;
    staffName: string;
    staffShort: string;
    staffColor: string | null;
    source: EventSource;
    seriesId: string | null;
    resourceId: string | null;
    resourceName: string | null;
    addonCount: number;
    note: string | null;
    checkedIn: boolean;
    bookedAt: Date | null;
    remindedAt: Date | null;
    intent: Intent;
    // Ended but still open: staff owe it a Completed or a No-show.
    needsClose: boolean;
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
    resource_id: string | null;
    resource_name: string | null;
    item_id: string;
    item_name: string;
    item_color: string | null;
    item_price: number;
    booked_count: number;
    booking_id: string | null;
    booking_status: string | null;
    client_id: string | null;
    client_name: string | null;
    pet_name: string | null;
    source: string | null;
    deposit_amount_cents: number | null;
    deposit_status: string | null;
    booking_price: number | null;
    checked_in_at: string | null;
    booked_at: string | null;
    reminded_at: string | null;
    addon_count: number;
    note: string | null;
}

// One row per visit; a class session (capacity over one) is one row with its seats counted.
export const EVENTS_SQL = `
SELECT s.id AS slot_id, s.starts_at, s.ends_at, s.staff_id, s.capacity, s.status AS slot_status,
       s.recurrence_id, s.resource_id, r.name AS resource_name,
       i.id AS item_id, i.name AS item_name, i.color AS item_color, i.price_cents AS item_price,
       (SELECT COUNT(*) FROM bookings x WHERE x.slot_id = s.id
          AND x.status NOT IN ('canceled', 'waitlisted') AND x.deleted_at IS NULL) AS booked_count,
       b.id AS booking_id, b.status AS booking_status, b.client_id, c.name AS client_name,
       sj.name AS pet_name, b.source, b.deposit_amount_cents, b.deposit_status,
       b.price_cents AS booking_price, b.checked_in_at, b.created_at AS booked_at, b.reminded_at,
       (SELECT COUNT(*) FROM addons a WHERE a.booking_id = b.id) AS addon_count,
       (SELECT n.body FROM notes n WHERE n.parent_type = 'booking' AND n.parent_id = b.id
          ORDER BY n.created_at LIMIT 1) AS note
FROM slots s
JOIN items i ON i.id = s.item_id
LEFT JOIN bookings b ON s.capacity <= 1 AND b.slot_id = s.id AND b.deleted_at IS NULL
  AND b.status != 'canceled'
LEFT JOIN clients c ON c.id = b.client_id
LEFT JOIN subjects sj ON sj.id = b.subject_id
LEFT JOIN resources r ON r.id = s.resource_id
WHERE s.status != 'canceled'
  AND ${utcSql("s.starts_at")} < datetime(?)
  AND ${utcSql("s.ends_at")} > datetime(?)
ORDER BY s.starts_at`;

/** 12-hour clock without the period: 9 or 4:30, or 9:00 with `minutes`. */
export function clock(d: Date, minutes = false): string {
    const h = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12;
    return d.getMinutes() === 0 && !minutes
        ? String(h)
        : `${String(h)}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function enrich(r: EventRow, staff: Map<string, StaffRow>, now: Date): ScheduleEvent {
    const start = parseTimestamp(r.starts_at);
    const end = parseTimestamp(r.ends_at);
    const isClass = r.capacity > 1;
    const status = isClass ? r.slot_status : (r.booking_status ?? r.slot_status);
    const member = staff.get(r.staff_id);
    const name = member ? staffName(member) : "";
    const open = status === "confirmed" || status === "pending" || status === "scheduled";
    const headline = isClass
        ? r.item_name
        : [r.pet_name, r.client_name]
              .filter((x): x is string => x !== null && x !== "")
              .join(" · ");
    const sameHalf = start.getHours() < 12 === end.getHours() < 12;
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
        priceCents: isClass ? r.item_price : (r.booking_price ?? r.item_price),
        serviceName: r.item_name,
        clientName: r.client_name,
        petName: r.pet_name,
        staffName: name,
        staffShort: firstName(name),
        staffColor: member?.color ?? null,
        source: r.source === "online" ? "online" : "staff",
        seriesId: r.recurrence_id,
        resourceId: r.resource_id,
        resourceName: r.resource_name,
        addonCount: r.addon_count,
        note: r.note,
        checkedIn: r.checked_in_at !== null,
        bookedAt: r.booked_at !== null ? parseTimestamp(r.booked_at) : null,
        remindedAt: r.reminded_at !== null ? parseTimestamp(r.reminded_at) : null,
        intent: statusIntent(status),
        needsClose: open && !isClass && end <= now,
        inProgress: open && start <= now && end > now,
        timeLabel: `${formatTime(start)} – ${formatTime(end)}`,
        timeShort: sameHalf
            ? `${clock(start, true)}–${formatTime(end)}`
            : `${formatTime(start)} – ${formatTime(end)}`,
        headline: headline === "" ? r.item_name : headline,
    };
}

/** The current time, refreshed every `ms`, so now lines and "needs closing" keep up. */
export function useNow(ms = 60_000): Date {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const timer = setInterval(() => {
            setNow(new Date());
        }, ms);
        return () => {
            clearInterval(timer);
        };
    }, [ms]);
    return now;
}

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

/** Every visit between two times, with client, pet, series, station and add-on count. */
export function useScheduleEvents(
    start: Date,
    end: Date,
): { events: ScheduleEvent[]; isLoading: boolean; error: Error | undefined } {
    const { data, isLoading, error } = useQuery<EventRow>(EVENTS_SQL, [
        end.toISOString(),
        start.toISOString(),
    ]);
    const staff = useActiveStaff();
    const now = useNow();
    const events = useMemo(
        () => data.map((r) => enrich(r, staff.byId, now)),
        [data, staff.byId, now],
    );
    return { events, isLoading, error };
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
WHERE basis = 'exception'
  AND ${utcSql("starts_at")} < datetime(?) AND ${utcSql("ends_at")} > datetime(?)
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

const weekdayIndex = (d: Date): number => (d.getDay() + 6) % 7;

function atTime(day: Date, hhmm: string | null, fallback: string): Date {
    const [h = 0, m = 0] = (hhmm ?? fallback).split(":").map(Number);
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
}

/** Hours, time off and closures for a range, and the checks the server makes before a booking. */
export interface Availability {
    // Open windows a member works on a day; null when they have no hours set (the server allows any time).
    windows: (staffId: string, day: Date) => Window[] | null;
    hours: (staffId: string, day: Date) => Window | null;
    blocks: (day: Date) => ScheduleBlock[];
    away: (staffId: string, start: Date, end: Date) => ScheduleBlock | null;
    isClosed: (day: Date) => ScheduleBlock | null;
    awayRows: ScheduleBlock[];
}

export function useAvailability(start: Date, end: Date): Availability & { sources: LoadSources } {
    const hours = useQuery<HoursRow>(WORKING_HOURS_SQL);
    const away = useQuery<AwayRow>(AWAY_SQL, [end.toISOString(), start.toISOString()]);
    const availability = useMemo(
        () => buildAvailability(hours.data, away.data),
        [hours.data, away.data],
    );
    return { ...availability, sources: [hours, away] };
}

type LoadSources = { isLoading: boolean; error?: Error | undefined }[];

function buildAvailability(hours: HoursRow[], away: AwayRow[]): Availability {
    const awayRows: ScheduleBlock[] = away.map((a) => ({
        id: a.id,
        staffId: a.staff_id,
        start: parseTimestamp(a.starts_at),
        end: parseTimestamp(a.ends_at),
        kind: a.staff_id === null ? "closure" : "time_off",
        label: a.reason ?? "",
    }));
    const windows = (staffId: string, day: Date): Window[] | null => {
        const key = dateKey(day);
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
                          h.weekday === weekdayIndex(day),
                  );
        if (rows.length === 0) return null;
        return rows
            .filter((h) => h.available === 1)
            .map((h) => ({
                start: atTime(day, h.start_time, "00:00"),
                end:
                    h.end_time === null
                        ? addDays(startOfDay(day), 1)
                        : atTime(day, h.end_time, "23:59"),
            }))
            .sort((a, b) => a.start.getTime() - b.start.getTime());
    };
    const blocks = (day: Date): ScheduleBlock[] => {
        const from = startOfDay(day);
        const to = addDays(from, 1);
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
            const from = startOfDay(day);
            const to = addDays(from, 1);
            return (
                awayRows.find((b) => b.staffId === null && b.start <= from && b.end >= to) ?? null
            );
        },
        awayRows,
    };
}

type MoveProblem = "overlap" | "off_hours" | "time_off" | "closed" | "past" | null;

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
): { problem: MoveProblem; message: string } {
    const member = staff.get(staffId);
    const who = member ? firstName(staffName(member)) : "";
    const away = avail.away(staffId, start, end);
    if (away?.staffId === null) return { problem: "closed", message: s.problemClosed(away.label) };
    if (away) return { problem: "time_off", message: s.problemTimeOff(who, away.label) };
    const w = avail.windows(staffId, start);
    if (w !== null && !w.some((x) => x.start <= start && end <= x.end)) {
        return { problem: "off_hours", message: s.problemOffHours(who) };
    }
    const clash = events.find(
        (e) =>
            e.id !== ignoreId &&
            e.staffId === staffId &&
            e.status !== "canceled" &&
            e.start < end &&
            e.end > start,
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
    const found =
        mode === "move" && start < now && start.getTime() !== event.start.getTime()
            ? { problem: "past" as const, message: s.problemPast }
            : slotProblem(ctx.avail, ctx.events, ctx.staff, staffId, start, end, event.id);
    const message =
        found.problem !== null
            ? found.message
            : mode === "resize"
              ? s.resizeTo(formatTime(end), Math.round((end.getTime() - start.getTime()) / MIN))
              : s.dragTo(`${formatWeekday(start)} ${formatTime(start)}`, who);
    return {
        start,
        end,
        staffId,
        label: `${formatTime(start)} – ${formatTime(end)}`,
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
        case "resource":
            return s.problemRoom;
        case "class":
            return s.problemClass;
        default:
            return v.message ?? s.dropRefused;
    }
}

export interface MoveEvent {
    // Asks the server for its verdict on where a drag is hovering; the answer lands in `verdict`.
    check: (event: ScheduleEvent, plan: MovePlan) => void;
    verdict: { key: string; ok: boolean; message: string } | null;
    move: (event: ScheduleEvent, plan: MovePlan) => void;
    // Moves shown before sync brings the new times back.
    pending: Record<string, PendingMove>;
    last: MovePlan | null;
    refusal: string | null;
    undo: () => void;
    dismiss: () => void;
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

    const patch = (event: ScheduleEvent, to: PendingMove, onFail: () => void): void => {
        const bookingId = event.bookingId;
        if (bookingId === null) return;
        setPending((p) => ({ ...p, [event.id]: to }));
        api.patch(`/v1/bookings/${bookingId}`, {
            starts_at: to.start.toISOString(),
            ends_at: to.end.toISOString(),
            staff_id: to.staffId,
        })
            .catch(onFail)
            .finally(() => {
                setTimeout(() => {
                    setPending((prev) => omitKey(prev, event.id));
                }, 4000);
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
            setLast({ plan, event });
            patch(event, plan, () => {
                setLast(null);
                setPending((prev) => omitKey(prev, event.id));
                setRefusal(s.rescheduleError);
            });
        },
        pending,
        last: last?.plan ?? null,
        refusal,
        undo: () => {
            if (!last) return;
            const { event } = last;
            setLast(null);
            patch(event, { start: event.start, end: event.end, staffId: event.staffId }, () => {
                setRefusal(s.actionError);
            });
        },
        dismiss: () => {
            setLast(null);
        },
    };
}

function applyPending(
    events: ScheduleEvent[],
    pending: Record<string, PendingMove>,
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
            timeLabel: `${formatTime(p.start)} – ${formatTime(p.end)}`,
        };
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
    const first = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => {
        const date = addDays(first, i);
        const n = events.filter((e) => sameDay(e.start, date)).length;
        return {
            key: dateKey(date),
            date,
            weekday: formatWeekday(date),
            day: String(date.getDate()),
            busy: n === 0 ? 0 : n < 4 ? 1 : n < 8 ? 2 : 3,
            closed: avail.isClosed(date) !== null,
            isToday: sameDay(date, now),
        };
    });
}

function laneFor(
    member: StaffRow,
    day: Date,
    events: ScheduleEvent[],
    avail: Availability,
): StaffLane {
    const name = staffName(member);
    const unset = avail.windows(member.id, day) === null;
    const allDay = avail.away(member.id, startOfDay(day), addDays(startOfDay(day), 1));
    const covers =
        allDay !== null &&
        allDay.start <= startOfDay(day) &&
        allDay.end >= addDays(startOfDay(day), 1);
    const hours = covers ? null : avail.hours(member.id, day);
    const mine = events.filter((e) => e.staffId === member.id && sameDay(e.start, day));
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
            ? s.hoursRange(formatTime(hours.start), formatTime(hours.end))
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
    now: Date;
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
    window: { startHour: number; endHour: number };
    selectedId: string | null;
    select: (id: string | null) => void;
    selected: ScheduleEvent | null;
    week: WeekStripDay[];
    avail: Availability;
    staff: Map<string, StaffRow>;
    load: Load;
}

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
    pending: Record<string, PendingMove> = {},
): ScheduleBoard {
    const now = useNow();
    const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
    const [selectedId, select] = useState<string | null>(null);
    const weekStart = startOfWeek(anchor);
    const weekEnd = addDays(weekStart, 7);
    const raw = useScheduleEvents(weekStart, weekEnd);
    const avail = useAvailability(weekStart, weekEnd);
    const staff = useActiveStaff();
    const ownOnly = viewer !== null && !canManagePayments(viewer.role);
    const members = ownOnly ? staff.rows.filter((m) => m.id === viewer.staffId) : staff.rows;
    const weekEvents = useMemo(() => applyPending(raw.events, pending), [raw.events, pending]);
    const dayEvents = weekEvents.filter((e) => sameDay(e.start, anchor));
    const lanes = members.map((m) => laneFor(m, anchor, weekEvents, avail));
    const focus: DayColumn = {
        date: anchor,
        key: dateKey(anchor),
        isToday: sameDay(anchor, now),
        closure: avail.isClosed(anchor),
        events: dayEvents,
        lanes,
    };
    let startHour = 24;
    let endHour = 0;
    for (const l of lanes) {
        if (l.hours) {
            startHour = Math.min(startHour, l.hours.start.getHours());
            endHour = Math.max(
                endHour,
                l.hours.end.getHours() + (l.hours.end.getMinutes() > 0 ? 1 : 0),
            );
        }
    }
    for (const e of dayEvents) {
        startHour = Math.min(startHour, e.start.getHours());
        endHour = Math.max(endHour, e.end.getHours() + (e.end.getMinutes() > 0 ? 1 : 0));
    }
    if (startHour >= endHour) {
        startHour = 9;
        endHour = 17;
    }
    const load = useReplicaLoad([raw, ...avail.sources], false);
    return {
        now,
        anchor,
        setAnchor: (day) => {
            setAnchor(startOfDay(day));
        },
        goToday: () => {
            setAnchor(startOfDay(new Date()));
        },
        shift: (dir) => {
            setAnchor((a) => addDays(a, dir));
        },
        label: sameDay(anchor, now)
            ? `${s.today} · ${formatFullDate(anchor)}`
            : formatFullDate(anchor),
        lanes,
        focus,
        summary: summarize(focus),
        events: dayEvents,
        weekEvents,
        window: { startHour, endHour },
        selectedId,
        select,
        selected: weekEvents.find((e) => e.id === selectedId) ?? null,
        week: weekStrip(anchor, weekEvents, avail, now),
        avail,
        staff: staff.byId,
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
): PlacedEvent[] {
    const byId = new Map(events.map((e) => [e.id, e]));
    const offset = startHour * 60 * pxPerMin;
    return layoutDay(events, {
        dayStart: startOfDay(day),
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

export function minuteTop(d: Date, startHour: number, pxPerMin: number): number {
    return (d.getHours() * 60 + d.getMinutes() - startHour * 60) * pxPerMin;
}

/** Shaded spans outside a lane's working hours (or the whole window on a day off), in minutes from the window start. */
export function offHourSpans(
    lane: StaffLane,
    startHour: number,
    endHour: number,
): { from: number; to: number }[] {
    const total = (endHour - startHour) * 60;
    if (lane.unset) return [];
    if (!lane.hours) return [{ from: 0, to: total }];
    const a = lane.hours.start.getHours() * 60 + lane.hours.start.getMinutes() - startHour * 60;
    const b = lane.hours.end.getHours() * 60 + lane.hours.end.getMinutes() - startHour * 60;
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
    return [e.timeLabel, e.headline, e.serviceName, e.staffName, s.statusLabel(e.status)]
        .filter(Boolean)
        .join(", ");
}

/** Visits that ended without a Completed or No-show, oldest first. */
export const needsClosing = (events: readonly ScheduleEvent[]): ScheduleEvent[] =>
    events.filter((e) => e.needsClose);

/** The next visits that haven't started, soonest first. */
export const upNext = (events: readonly ScheduleEvent[], now: Date, n = 3): ScheduleEvent[] =>
    events
        .filter((e) => e.start > now && (e.status === "confirmed" || e.status === "pending"))
        .slice(0, n);

interface VisitPet {
    id: string;
    name: string;
    breed: string | null;
    temperament: string | null;
}

interface DetailClientRow {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    tags: string | null;
}

interface PetRow {
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
    pet_name: string | null;
    deposit_status: string;
}

interface VisitStatsRow {
    visits: number;
    last_visit: string | null;
}

export const DETAIL_CLIENT_SQL = "SELECT id, name, phone, email, tags FROM clients WHERE id = ?";

export const DETAIL_PET_SQL = `
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
SELECT b.id AS booking_id, b.status, c.name AS client_name, sj.name AS pet_name, b.deposit_status
FROM bookings b JOIN clients c ON c.id = b.client_id
LEFT JOIN subjects sj ON sj.id = b.subject_id
WHERE b.slot_id = ? AND b.status != 'canceled' AND b.deleted_at IS NULL
ORDER BY b.status = 'waitlisted', b.created_at`;

export const VISIT_STATS_SQL = `
SELECT COUNT(*) AS visits, MAX(s.starts_at) AS last_visit
FROM bookings b JOIN slots s ON s.id = b.slot_id
WHERE b.client_id = ? AND b.status = 'completed' AND b.deleted_at IS NULL`;

function petOf(row: PetRow | undefined): VisitPet | null {
    if (row === undefined) return null;
    let attrs: Record<string, unknown> = {};
    try {
        const parsed: unknown = row.attributes === null ? {} : JSON.parse(row.attributes);
        if (parsed !== null && typeof parsed === "object")
            attrs = parsed as Record<string, unknown>;
    } catch {
        attrs = {};
    }
    const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
    return {
        id: row.id,
        name: row.name,
        breed: text(attrs.breed),
        temperament: text(attrs.temperament),
    };
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

export interface BookingDetail {
    event: ScheduleEvent;
    client: DetailClientRow | null;
    clientLine: string;
    pet: VisitPet | null;
    petLine: string | null;
    petNervous: boolean;
    tags: string[];
    notes: NoteRow[];
    series: string | null;
    depositLine: string | null;
    depositIntent: Intent;
    history: TimelineEntry[];
    timing: string;
    roster: { id: string; name: string; pet: string; waiting: boolean; unpaid: boolean }[];
}

function timingLabel(e: ScheduleEvent, now: Date): string {
    const toStart = Math.round((e.start.getTime() - now.getTime()) / MIN);
    const toEnd = Math.round((e.end.getTime() - now.getTime()) / MIN);
    if (e.status === "completed") return s.completed;
    if (e.status === "no_show") return s.noShowDone;
    if (e.needsClose) return s.endedAgo;
    if (e.inProgress) return s.endsIn(toEnd);
    if (toStart > 0 && sameDay(e.start, now)) return s.startsIn(s.timeUntil(toStart));
    return formatFullDate(e.start);
}

const stamp = (d: Date): string =>
    `${d.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}, ${formatTime(d)}`;

/** Everything the booking panel shows about one visit: client, pet, notes, deposit and history. */
export function useBookingDetail(event: ScheduleEvent | null, now: Date): BookingDetail | null {
    const bookingId = event?.bookingId ?? "";
    const clientId = event?.clientId ?? "";
    const client = useQuery<DetailClientRow>(DETAIL_CLIENT_SQL, [clientId]).data.at(0) ?? null;
    const pet = petOf(useQuery<PetRow>(DETAIL_PET_SQL, [bookingId]).data.at(0));
    const notes = useQuery<NoteRow>(DETAIL_NOTES_SQL, [bookingId, clientId]).data;
    const series = useQuery<SeriesRow>(DETAIL_SERIES_SQL, [event?.slotId ?? ""]).data.at(0);
    const roster = useQuery<RosterRow>(DETAIL_ROSTER_SQL, [
        event?.kind === "class" ? event.slotId : "",
    ]).data;
    const stats = useQuery<VisitStatsRow>(VISIT_STATS_SQL, [clientId]).data.at(0);
    if (event === null) return null;
    const amount = formatMoney(event.depositAmountCents);
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
    if (event.checkedIn)
        history.push({ key: "here", label: s.historyCheckedIn, at: "", intent: "accent" });
    if (event.status === "completed")
        history.push({ key: "done", label: s.completed, at: stamp(event.end), intent: "success" });
    if (event.status === "no_show")
        history.push({
            key: "done",
            label: s.noShowDone,
            at: stamp(event.start),
            intent: "danger",
        });
    const visits = stats?.visits ?? 0;
    const last = stats?.last_visit ? parseTimestamp(stats.last_visit) : null;
    return {
        event,
        client,
        clientLine: [
            client?.phone ? formatPhone(client.phone) : null,
            visits > 0 ? s.visitsCount(visits) : s.firstVisit,
            last !== null ? s.lastVisit(formatDate(last)) : null,
        ]
            .filter(Boolean)
            .join(" · "),
        pet,
        petLine: pet ? [pet.breed, pet.temperament].filter(Boolean).join(" · ") || null : null,
        petNervous: pet?.temperament === "anxious" || pet?.temperament === "skittish",
        tags: parseTags(client?.tags ?? null),
        notes,
        series: series
            ? s.seriesLabel(
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
        timing: timingLabel(event, now),
        roster: roster.map((r) => ({
            id: r.booking_id,
            name: r.client_name,
            pet: r.pet_name ?? "",
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
    run: (action: LifecycleAction) => void;
}

/** Completed and No-show once a visit has started; Cancel and Reschedule while it's still ahead. */
export function useBookingActions(
    api: ApiLike,
    event: ScheduleEvent | null,
    now: Date,
    onDone?: (action: LifecycleAction) => void,
): BookingActions {
    const { busy, error, run } = useAsyncAction();
    const [pending, setPending] = useState<LifecycleAction | null>(null);
    const open =
        event !== null &&
        event.bookingId !== null &&
        (event.status === "confirmed" || event.status === "pending");
    const started = event !== null && event.start <= now;
    const amount = formatMoney(event?.depositAmountCents ?? 0);
    const paid = event !== null && event.depositRequired && event.depositStatus === "collected";
    const due = event !== null && event.depositRequired && event.depositStatus === "pending";
    return {
        canComplete: open && started,
        canNoShow: open && started,
        canCancel: open && !started,
        canReschedule: open && !started,
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
                errorMessage: s.actionError,
            });
        },
    };
}

export interface ComposerSlot {
    staffId: string;
    start: Date;
}

interface PetOption {
    id: string;
    client_id: string;
    name: string;
}

export const CLIENT_PETS_SQL =
    "SELECT id, client_id, name FROM subjects ORDER BY name COLLATE NOCASE";

const pad = (n: number): string => String(n).padStart(2, "0");

function startTimes(): { key: string; label: string }[] {
    const out: { key: string; label: string }[] = [];
    for (let hh = 6; hh <= 21; hh++)
        for (const mm of [0, 15, 30, 45])
            out.push({
                key: `${pad(hh)}:${pad(mm)}`,
                label: formatTime(new Date(2000, 0, 1, hh, mm)),
            });
    return out;
}

export interface BookingComposer {
    query: string;
    setQuery: (q: string) => void;
    matches: { client: ClientRow; pets: string[] }[];
    client: ClientRow | null;
    pickClient: (id: string | null) => void;
    pets: PetOption[];
    petId: string;
    setPetId: (id: string) => void;
    services: ItemRow[];
    item: ItemRow | null;
    setItemId: (id: string) => void;
    staffId: string;
    setStaffId: (id: string) => void;
    staffOptions: { id: string; name: string; free: boolean }[];
    day: string;
    setDay: (key: string) => void;
    time: string;
    setTime: (hhmm: string) => void;
    endsLabel: string;
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
}

/** Free starts every 15 minutes for one member and day, grouped for a slot picker; keys are "HH:MM". */
function openGroups(
    board: { avail: Availability; events: readonly CalendarEvent[]; staff: Map<string, StaffRow> },
    staffId: string,
    day: Date,
    length: number,
    now: Date,
): { label: string; slots: { key: string; label: string; disabled?: boolean }[] }[] {
    const windows = board.avail.windows(staffId, day) ?? [
        { start: atTime(day, "08:00", "08:00"), end: atTime(day, "18:00", "18:00") },
    ];
    const slots: { key: string; label: string; disabled: boolean; hour: number }[] = [];
    for (const w of windows) {
        for (let t = w.start.getTime(); t + length * MIN <= w.end.getTime(); t += 15 * MIN) {
            const at = new Date(t);
            if (at < now) continue;
            const end = new Date(t + length * MIN);
            const found = slotProblem(
                board.avail,
                board.events,
                board.staff,
                staffId,
                at,
                end,
                null,
            );
            slots.push({
                key: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
                label: clock(at, true),
                disabled: found.problem !== null,
                hour: at.getHours(),
            });
        }
    }
    const part = (label: string, from: number, to: number) => ({
        label,
        slots: slots
            .filter((x) => x.hour >= from && x.hour < to)
            .map((x) => ({ key: x.key, label: x.label, disabled: x.disabled })),
    });
    return [part(s.morning, 0, 12), part(s.afternoon, 12, 17), part(s.evening, 17, 24)].filter(
        (g) => g.slots.length > 0,
    );
}

function depositOf(item: ItemRow | null): number {
    if (item === null || item.deposit_type === "none" || item.deposit_value === null) return 0;
    return item.deposit_type === "fixed"
        ? item.deposit_value
        : Math.round(((item.price_cents ?? 0) * item.deposit_value) / 100);
}

/** The new-booking form, prefilled from the open time that was clicked; checks the slot as it changes. */
export function useBookingComposer(
    api: ApiLike,
    slot: ComposerSlot,
    board: { avail: Availability; events: readonly ScheduleEvent[]; staff: Map<string, StaffRow> },
    onCreated: () => void,
): BookingComposer {
    const clients = useClients();
    const allPets = useQuery<PetOption>(CLIENT_PETS_SQL).data;
    const services = bookableItems(useCatalogItems());
    const [query, setQuery] = useState("");
    const [clientId, setClientId] = useState<string | null>(null);
    const [petId, setPetId] = useState("");
    const [itemId, setItemId] = useState("");
    const [staffId, setStaffId] = useState(slot.staffId);
    const [day, setDay] = useState(dateKey(slot.start));
    const [time, setTime] = useState(
        `${pad(slot.start.getHours())}:${pad(slot.start.getMinutes())}`,
    );
    const [repeat, setRepeat] = useState(false);
    const [every, setEvery] = useState(4);
    const [count, setCount] = useState(6);
    const [note, setNote] = useState("");
    const [notify, setNotify] = useState(true);
    const [notice, setNotice] = useState<string | null>(null);
    const { busy, error, setError, run } = useAsyncAction();
    const key = useRef<string | null>(null);

    const item = services.find((i) => i.id === itemId) ?? null;
    const client = clients.find((c) => c.id === clientId) ?? null;
    const [y = 2026, mo = 1, d = 1] = day.split("-").map(Number);
    const [h = 9, m = 0] = time.split(":").map(Number);
    const start = new Date(y, mo - 1, d, h, m);
    const length = item?.duration_min ?? 60;
    const end = new Date(start.getTime() + length * MIN);
    const q = query.trim().toLowerCase();
    const petsOf = (id: string): PetOption[] => allPets.filter((p) => p.client_id === id);
    const matches = clients
        .filter((c) => c.status === "active")
        .map((c) => ({ client: c, pets: petsOf(c.id).map((p) => p.name) }))
        .filter(
            (x) =>
                q === "" ||
                [x.client.name, x.client.phone ?? "", ...x.pets].some((v) =>
                    v.toLowerCase().includes(q),
                ),
        )
        .slice(0, 6);
    const now = new Date();
    const check = (who: string): { problem: MoveProblem; message: string } =>
        start < now
            ? { problem: "past", message: s.problemPast }
            : slotProblem(board.avail, board.events, board.staff, who, start, end, null);
    const verdict = check(staffId);
    const problem = item !== null && verdict.problem !== null ? verdict.message : null;
    const deposit = depositOf(item);

    return {
        query,
        setQuery,
        matches,
        client,
        pickClient: (id) => {
            setClientId(id);
            setPetId(id === null ? "" : (petsOf(id).at(0)?.id ?? ""));
            setQuery("");
        },
        pets: client ? petsOf(client.id) : [],
        petId,
        setPetId,
        services,
        item,
        setItemId,
        staffId,
        setStaffId,
        staffOptions: [...board.staff.values()].map((x) => ({
            id: x.id,
            name: staffName(x),
            free: check(x.id).problem === null,
        })),
        day,
        setDay,
        time,
        setTime,
        endsLabel: s.composerEnds(formatTime(end), length),
        repeat,
        setRepeat,
        every,
        setEvery,
        count,
        setCount,
        note,
        setNote,
        notify,
        setNotify,
        depositLine: deposit > 0 ? s.composerDeposit(formatMoney(deposit)) : null,
        problem,
        notice,
        canSubmit: client !== null && item !== null && problem === null,
        submit: () => {
            if (client === null || item === null) {
                setError(s.composerIncomplete);
                return;
            }
            key.current ??= newIdempotencyKey();
            const idempotencyKey = key.current;
            const body = {
                client_id: client.id,
                subject_id: petId === "" ? null : petId,
                item_id: item.id,
                staff_id: staffId,
                starts_at: start.toISOString(),
            };
            let skipped = 0;
            let created = 0;
            run(
                async () => {
                    if (repeat) {
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
                    errorMessage: s.composerError,
                },
            );
        },
        busy,
        error,
        timeOptions: startTimes(),
        days: weekStrip(
            start,
            board.events.filter((e) => e.staffId === staffId),
            board.avail,
            now,
        ).map((x) => ({
            ...x,
            disabled:
                addDays(x.date, 1) <= now ||
                board.avail.isClosed(x.date) !== null ||
                (board.avail.windows(staffId, x.date)?.length ?? 1) === 0,
        })),
        slotGroups: openGroups(board, staffId, new Date(y, mo - 1, d), length, now),
    };
}

export interface Reschedule {
    days: WeekStripDay[];
    day: string;
    setDay: (key: string) => void;
    staffId: string;
    setStaffId: (id: string) => void;
    staffOptions: { key: string; label: string }[];
    groups: { label: string; slots: { key: string; label: string; disabled?: boolean }[] }[];
    open: number;
    value: string | null;
    setValue: (key: string) => void;
    target: string | null;
    submit: () => void;
    busy: boolean;
    error: string | null;
    shiftWeek: (dir: 1 | -1) => void;
}

/** Free starts every 15 minutes for one person and day, checked the same way a drag is. */
export function useReschedule(api: ApiLike, event: ScheduleEvent, onDone: () => void): Reschedule {
    const now = useNow();
    const first = event.start < now ? now : event.start;
    const [weekAnchor, setWeekAnchor] = useState(() => startOfWeek(first));
    const [day, setDay] = useState(dateKey(first));
    const [staffId, setStaffId] = useState(event.staffId);
    const [value, setValue] = useState<string | null>(null);
    const { busy, error, run } = useAsyncAction();
    const weekEnd = addDays(weekAnchor, 7);
    const { events } = useScheduleEvents(weekAnchor, weekEnd);
    const avail = useAvailability(weekAnchor, weekEnd);
    const staff = useActiveStaff();
    const [y = 2026, mo = 1, d = 1] = day.split("-").map(Number);
    const date = new Date(y, mo - 1, d);
    const length = (event.end.getTime() - event.start.getTime()) / MIN;
    const ctx = { avail, events, staff: staff.byId };
    const windows = avail.windows(staffId, date) ?? [
        { start: atTime(date, "08:00", "08:00"), end: atTime(date, "18:00", "18:00") },
    ];
    const slots: { key: string; label: string; disabled?: boolean; hour: number }[] = [];
    for (const w of windows) {
        for (let t = w.start.getTime(); t + length * MIN <= w.end.getTime(); t += 15 * MIN) {
            const start = new Date(t);
            if (start < now) continue;
            const plan = planMove(event, (t - event.start.getTime()) / MIN, staffId, ctx, now);
            const same = start.getTime() === event.start.getTime() && staffId === event.staffId;
            slots.push({
                key: start.toISOString(),
                label: clock(start, true),
                disabled: plan.problem !== null || same,
                hour: start.getHours(),
            });
        }
    }
    const group = (label: string, from: number, to: number) => ({
        label,
        slots: slots
            .filter((x) => x.hour >= from && x.hour < to)
            .map((x) => ({ key: x.key, label: x.label, disabled: x.disabled === true })),
    });
    const groups = [
        group(s.morning, 0, 12),
        group(s.afternoon, 12, 17),
        group(s.evening, 17, 24),
    ].filter((g) => g.slots.length > 0);
    const picked = value !== null ? new Date(value) : null;
    return {
        days: weekStrip(
            weekAnchor,
            events.filter((e) => e.staffId === staffId),
            avail,
            now,
        ).map((x) => ({
            ...x,
            disabled:
                addDays(x.date, 1) <= now ||
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
        staffOptions: staff.rows.map((x) => ({ key: x.id, label: firstName(staffName(x)) })),
        groups,
        open: slots.filter((x) => x.disabled !== true).length,
        value,
        setValue,
        target: picked
            ? `${formatWeekday(picked)} ${picked.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}, ${formatTime(picked)}`
            : null,
        submit: () => {
            if (picked === null || event.bookingId === null) return;
            const bookingId = event.bookingId;
            run(
                () =>
                    api.patch(`/v1/bookings/${bookingId}`, {
                        starts_at: picked.toISOString(),
                        staff_id: staffId,
                    }),
                { onSuccess: onDone, errorMessage: s.rescheduleError },
            );
        },
        busy,
        error,
        shiftWeek: (dir) => {
            setWeekAnchor((a) => addDays(a, dir * 7));
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
}

/** A saved method charges now; otherwise the platform card form confirms the returned client secret. */
export function useCollectDeposit(
    api: ApiLike,
    event: CalendarEvent,
    onDone: () => void,
    defaultMethod?: string,
): CollectDeposit {
    const checkout = useCheckout(onDone, defaultMethod !== undefined ? { defaultMethod } : {});
    const submit = (): void => {
        const bookingId = event.bookingId;
        if (bookingId === null) return;
        checkout.pay(({ paymentMethodId, idempotencyKey }) => {
            const query =
                paymentMethodId !== undefined && paymentMethodId !== ""
                    ? `?payment_method_id=${encodeURIComponent(paymentMethodId)}`
                    : "";
            return api.post<DepositResult>(
                `/v1/bookings/${bookingId}/deposit${query}`,
                {},
                { idempotencyKey },
            );
        }, s.collectDepositError);
    };
    return { checkout, submit };
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
    const key = useRef<string | null>(null);
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
            key.current ??= newIdempotencyKey();
            const idempotencyKey = key.current;
            run(() => api.post(`/v1/invoices/from-booking/${bookingId}`, {}, { idempotencyKey }), {
                errorMessage: s.invoiceVisitError,
            });
        },
        busy,
        error,
    };
}
