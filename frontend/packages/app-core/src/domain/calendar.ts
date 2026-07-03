import { useQuery } from "@powersync/react";
import { useMemo, useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import type { ApiLike } from "../util/api";
import { type ItemRow, useCatalogItems } from "./catalog";
import { type ClientRow, useClients } from "./clients";
import {
    addDays,
    dateKey,
    isSameMonth,
    parseTimestamp,
    startOfDay,
    startOfMonth,
    startOfWeek,
} from "../util/datetime";
import type { Intent } from "../util/primitives";
import { strings } from "../strings";
import { useInteractivePurchase } from "./payments";
import { type StaffRow, useStaff } from "./staff";

export interface CalendarEvent {
    id: string;
    sessionId: string;
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

export interface PositionedEvent {
    event: CalendarEvent;
    topPx: number;
    heightPx: number;
    leftPct: number;
    widthPct: number;
    columnIndex: number;
    columnCount: number;
}

export type CalendarView = "day" | "week" | "month" | "agenda" | "staff";

export const eventLabel = (e: CalendarEvent): string =>
    e.subtitle.length > 0 ? e.subtitle : e.title;

// The status → intent decision is shared; each platform maps the intent to its own tokens.
export function statusIntent(status: string): Intent {
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

export function depositStatusIntent(status: string): Intent {
    switch (status) {
        case "pending":
            return "warning";
        case "collected":
            return "success";
        case "forfeited":
            return "danger";
        default:
            return "neutral"; // none
    }
}

export function dayColumns(anchor: Date, count: number): Date[] {
    const start = startOfDay(anchor);
    return Array.from({ length: count }, (_, i) => addDays(start, i));
}

export function weekColumns(anchor: Date, weekStartsOn = 1): Date[] {
    return dayColumns(startOfWeek(anchor, weekStartsOn), 7);
}

export function monthMatrix(anchor: Date, weekStartsOn = 1): Date[][] {
    const first = startOfWeek(startOfMonth(anchor), weekStartsOn);
    return Array.from({ length: 6 }, (_, w) =>
        Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)),
    );
}

export function formatRangeLabel(cols: Date[], locale = "en-CA"): string {
    const first = cols.at(0);
    const last = cols.at(-1);
    if (!first || !last) return "";
    if (cols.length === 1) {
        return first.toLocaleDateString(locale, { month: "long", day: "numeric", year: "numeric" });
    }
    const a = first.toLocaleDateString(locale, { month: "short", day: "numeric" });
    const b = isSameMonth(first, last)
        ? `${last.getDate()}`
        : last.toLocaleDateString(locale, { month: "short", day: "numeric" });
    return `${a} – ${b}, ${first.getFullYear()}`;
}

export interface LayoutOptions {
    dayStart: Date;
    pxPerMin: number;
    minHeightPx?: number;
    gapPx?: number;
}

/** Chronological order for a day's events: earliest start first, longer events first on ties. */
export function compareEventStart(a: CalendarEvent, b: CalendarEvent): number {
    return a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime();
}

// Overlapping events chain into a group, then split into first-fit columns so none visually overlap.
export function layoutDay(events: CalendarEvent[], opts: LayoutOptions): PositionedEvent[] {
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
            let col = -1;
            for (let c = 0; c < colEnds.length; c++) {
                const end = colEnds[c];
                if (end !== undefined && end <= startMs) {
                    col = c;
                    break;
                }
            }
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
            const startMin = Math.max(0, (e.start.getTime() - dayStartMs) / 60_000);
            const endMin = Math.min(1440, (e.end.getTime() - dayStartMs) / 60_000);
            out.push({
                event: e,
                topPx: startMin * pxPerMin,
                heightPx: Math.max((endMin - startMin) * pxPerMin - gapPx, minHeightPx),
                leftPct: (col / colCount) * 100,
                widthPct: (1 / colCount) * 100,
                columnIndex: col,
                columnCount: colCount,
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

export function groupByStaff(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
        const list = map.get(e.staffId) ?? [];
        list.push(e);
        map.set(e.staffId, list);
    }
    return map;
}

export function groupByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
        const key = dateKey(e.start);
        const list = map.get(key) ?? [];
        list.push(e);
        map.set(key, list);
    }
    for (const list of map.values()) list.sort(compareEventStart);
    return map;
}

/** The hour window to render — default business hours, auto-expanded to fit any out-of-range event. */
export function dayBounds(
    events: CalendarEvent[],
    defaultStartHour = 7,
    defaultEndHour = 19,
): { startHour: number; endHour: number } {
    let startHour = defaultStartHour;
    let endHour = defaultEndHour;
    for (const e of events) {
        startHour = Math.min(startHour, e.start.getHours());
        endHour = Math.max(
            endHour,
            e.end.getMinutes() > 0 ? e.end.getHours() + 1 : e.end.getHours(),
        );
    }
    return {
        startHour: Math.max(0, startHour),
        endHour: Math.min(24, Math.max(endHour, startHour + 1)),
    };
}

export function snapMinutes(min: number, step = 5): number {
    return Math.round(min / step) * step;
}

export function dragToStart(
    originalStart: Date,
    deltaPx: number,
    pxPerMin: number,
    step = 5,
): Date {
    const deltaMin = snapMinutes(deltaPx / pxPerMin, step);
    return new Date(originalStart.getTime() + deltaMin * 60_000);
}

interface Row {
    session_id: string;
    booking_id: string | null;
    starts_at: string;
    ends_at: string;
    staff_id: string;
    capacity: number;
    booked_count: number;
    session_status: string;
    booking_status: string | null;
    item_name: string;
    item_color: string | null;
    client_name: string | null;
    client_id: string | null;
    deposit_required: number | null;
    deposit_amount_cents: number | null;
    deposit_status: string | null;
}

// PowerSync stores timestamptz with a bare "+00" offset (e.g. "2026-06-26 10:00:00+00"), which
// SQLite datetime() can't parse (it needs "+00:00"/"Z") and would return NULL for — silently
// filtering out EVERY event. Appending ":00" makes it "+00:00" so datetime() parses it; the ISO
// params (…Z) parse as-is. (Mirrors parseTimestamp's bare-offset fix.)
const EVENTS_SQL = `
SELECT s.id AS session_id, s.starts_at, s.ends_at, s.staff_id, s.capacity, s.booked_count,
       s.status AS session_status, i.name AS item_name, i.color AS item_color,
       b.id AS booking_id, b.status AS booking_status, c.name AS client_name,
       b.client_id AS client_id, b.deposit_required AS deposit_required,
       b.deposit_amount_cents AS deposit_amount_cents, b.deposit_status AS deposit_status
FROM sessions s
JOIN items i ON i.id = s.item_id
LEFT JOIN bookings b ON b.session_id = s.id AND b.deleted_at IS NULL
LEFT JOIN clients c ON c.id = b.client_id
WHERE s.status != 'canceled'
  AND datetime(s.starts_at || ':00') < datetime(?)
  AND datetime(s.ends_at || ':00') > datetime(?)`;

function toEvent(r: Row): CalendarEvent {
    return {
        id: r.booking_id ?? r.session_id,
        sessionId: r.session_id,
        bookingId: r.booking_id,
        start: parseTimestamp(r.starts_at),
        end: parseTimestamp(r.ends_at),
        title: r.item_name,
        subtitle: r.client_name ?? "",
        status: r.booking_status ?? r.session_status,
        staffId: r.staff_id,
        clientId: r.client_id,
        color: r.item_color,
        capacity: r.capacity,
        bookedCount: r.booked_count,
        depositRequired: r.deposit_required === 1,
        depositAmountCents: r.deposit_amount_cents ?? 0,
        depositStatus: r.deposit_status ?? "none",
    };
}

export function useCalendarEvents(
    rangeStart: Date,
    rangeEnd: Date,
    opts: { staffId?: string } = {},
): CalendarEvent[] {
    const { staffId } = opts;
    const sql = staffId ? `${EVENTS_SQL} AND s.staff_id = ?` : EVENTS_SQL;
    const startIso = rangeStart.toISOString();
    const endIso = rangeEnd.toISOString();
    const params = staffId ? [endIso, startIso, staffId] : [endIso, startIso];
    const { data } = useQuery<Row>(sql, params);
    return useMemo(() => data.map(toEvent), [data]);
}

export interface BookingResult {
    id: string;
    session_id: string;
    status: string;
    starts_at: string;
    ends_at: string;
}

export interface NewBooking {
    clientId: string;
    itemId: string;
    staffId: string;
    startsAt: Date;
    resourceId?: string | null;
}

export type BookingStatus = "confirmed" | "completed" | "canceled" | "no_show";

export function createBooking(api: ApiLike, input: NewBooking): Promise<BookingResult> {
    return api.post<BookingResult>("/v1/bookings", {
        client_id: input.clientId,
        item_id: input.itemId,
        staff_id: input.staffId,
        starts_at: input.startsAt.toISOString(),
        resource_id: input.resourceId ?? null,
    });
}

export type RecurFrequency = "daily" | "weekly" | "monthly";

/** Recurrence options with both display forms so each platform keeps its own phrasing without drift:
 *  `label` for a standalone chip ("Weekly"), `unit` for an "Every N …" control ("Weeks"). */
export const RECUR_FREQUENCIES: { value: RecurFrequency; label: string; unit: string }[] = [
    { value: "daily", label: strings.calendar.freqDaily, unit: strings.calendar.unitDays },
    { value: "weekly", label: strings.calendar.freqWeekly, unit: strings.calendar.unitWeeks },
    { value: "monthly", label: strings.calendar.freqMonthly, unit: strings.calendar.unitMonths },
];

export interface ScheduleResult {
    id: string;
    created: number; // occurrences that became bookings
    skipped: number; // occurrences skipped (overlap / outside hours)
}

export interface NewSchedule {
    clientId: string;
    itemId: string;
    staffId: string;
    startsAt: Date; // first occurrence; its time-of-day repeats
    frequency: RecurFrequency;
    interval: number;
    count: number; // end after N occurrences
    resourceId?: string | null;
}

export function createSchedule(api: ApiLike, input: NewSchedule): Promise<ScheduleResult> {
    return api.post<ScheduleResult>("/v1/schedules", {
        client_id: input.clientId,
        item_id: input.itemId,
        staff_id: input.staffId,
        starts_at: input.startsAt.toISOString(),
        frequency: input.frequency,
        interval: input.interval,
        count: input.count,
        resource_id: input.resourceId ?? null,
    });
}

export function rescheduleBooking(
    api: ApiLike,
    bookingId: string,
    startsAt: Date,
): Promise<BookingResult> {
    return api.patch<BookingResult>(`/v1/bookings/${bookingId}`, {
        starts_at: startsAt.toISOString(),
    });
}

export function setBookingStatus(
    api: ApiLike,
    bookingId: string,
    status: BookingStatus,
): Promise<BookingResult> {
    return api.patch<BookingResult>(`/v1/bookings/${bookingId}`, { status });
}

// Drag-drop reschedule: snap the vertical delta to a new start and PATCH it (fire-and-forget; a
// rejected move just leaves the booking where it was once sync reconciles).
export function rescheduleByDrag(
    api: ApiLike,
    event: CalendarEvent,
    deltaPx: number,
    pxPerMin: number,
): void {
    if (event.bookingId === null) return;
    const newStart = dragToStart(event.start, deltaPx, pxPerMin);
    if (newStart.getTime() === event.start.getTime()) return;
    rescheduleBooking(api, event.bookingId, newStart).catch(() => undefined);
}

export interface CancelBooking {
    busy: boolean;
    error: string | null;
    cancel: () => void;
}

/** Shared cancel-booking action: busy/error state + the status PATCH, calling `onDone` on success.
 *  An event with no booking (a bare session) just closes. */
export function useCancelBooking(
    api: ApiLike,
    event: CalendarEvent,
    onDone: () => void,
): CancelBooking {
    const { busy, error, run } = useAsyncAction();
    const cancel = (): void => {
        const bookingId = event.bookingId;
        if (bookingId === null) {
            onDone();
            return;
        }
        run(() => setBookingStatus(api, bookingId, "canceled"), {
            onSuccess: onDone,
            errorMessage: strings.calendar.cancelError,
        });
    };
    return { busy, error, cancel };
}

export interface DepositResult {
    booking_id: string;
    payment_id: string;
    client_secret: string;
}

export interface CollectDepositOptions {
    paymentMethodId?: string;
    idempotencyKey?: string;
}

/** Collect a booking's deposit (`POST /v1/bookings/{id}/deposit`). A saved `paymentMethodId` charges
 *  off-session now; without one the returned `client_secret` is confirmed by the platform card seam.
 *  `payment_method_id` is a query param (the endpoint takes no body). */
export function collectDeposit(
    api: ApiLike,
    bookingId: string,
    opts: CollectDepositOptions = {},
): Promise<DepositResult> {
    const query =
        opts.paymentMethodId !== undefined && opts.paymentMethodId !== ""
            ? `?payment_method_id=${encodeURIComponent(opts.paymentMethodId)}`
            : "";
    return api.post<DepositResult>(
        `/v1/bookings/${bookingId}/deposit${query}`,
        {},
        opts.idempotencyKey !== undefined ? { idempotencyKey: opts.idempotencyKey } : undefined,
    );
}

/** Owner/admin may collect a deposit while it's still outstanding (not collected or forfeited). */
export function canCollectDeposit(event: CalendarEvent): boolean {
    return (
        event.bookingId !== null &&
        event.depositRequired &&
        event.depositStatus !== "collected" &&
        event.depositStatus !== "forfeited"
    );
}

export interface CollectDeposit {
    busy: boolean;
    error: string | null;
    /** Set once an interactive (new-card) deposit needs a client-side confirm. */
    clientSecret: string | null;
    /** Pass a saved card id to charge off-session; omit it (or "") to confirm a new card. */
    collect: (paymentMethodId?: string) => void;
    cancel: () => void;
    complete: () => void;
}

/** Collect-deposit view-model: reuses the off-session-vs-client_secret purchase seam — a saved card
 *  finishes immediately; a new card yields a `client_secret` the platform confirms (web Elements /
 *  mobile native SDK). The Idempotency-Key dedups a double-submit server-side. */
export function useCollectDeposit(
    api: ApiLike,
    event: CalendarEvent,
    onDone: () => void,
): CollectDeposit {
    const purchase = useInteractivePurchase(onDone);

    const collect = (paymentMethodId?: string): void => {
        const bookingId = event.bookingId;
        if (bookingId === null) return;
        const saved =
            paymentMethodId !== undefined && paymentMethodId !== "" ? paymentMethodId : null;
        purchase.submit(
            (idempotencyKey) =>
                collectDeposit(api, bookingId, {
                    ...(saved !== null ? { paymentMethodId: saved } : {}),
                    idempotencyKey,
                }),
            saved === null,
            strings.calendar.collectDepositError,
        );
    };

    return {
        busy: purchase.busy,
        error: purchase.error,
        clientSecret: purchase.clientSecret,
        collect,
        cancel: purchase.cancel,
        complete: purchase.complete,
    };
}

export interface BookingFormState {
    clients: ClientRow[];
    items: ItemRow[];
    staff: StaffRow[];
    clientId: string;
    setClientId: (id: string) => void;
    itemId: string;
    setItemId: (id: string) => void;
    staffId: string;
    setStaffId: (id: string) => void;
    effStaff: string;
    repeat: boolean;
    setRepeat: (v: boolean) => void;
    frequency: RecurFrequency;
    setFrequency: (v: RecurFrequency) => void;
    interval: number;
    setInterval: (v: number) => void;
    count: number;
    setCount: (v: number) => void;
    notice: string | null; // set after a series that skipped occurrences, so the user sees it
    busy: boolean;
    error: string | null;
    submit: (startsAt: Date | null) => void;
}

/** Shared new-booking form: client/service/staff selection, validation, and submit. The platform
 *  owns only the date/time entry widget and passes the resulting Date to submit(). */
export function useBookingForm(api: ApiLike, onCreated: () => void): BookingFormState {
    const clients = useClients();
    const items = useCatalogItems();
    const staff = useStaff();
    const [clientId, setClientId] = useState("");
    const [itemId, setItemId] = useState("");
    const [staffId, setStaffId] = useState("");
    const [repeat, setRepeat] = useState(false);
    const [frequency, setFrequency] = useState<RecurFrequency>("weekly");
    const [interval, setInterval] = useState(1);
    const [count, setCount] = useState(8);
    const [notice, setNotice] = useState<string | null>(null);
    const { busy, error, setError, run } = useAsyncAction();

    const effStaff = staffId.length > 0 ? staffId : (staff.at(0)?.id ?? "");

    const submit = (startsAt: Date | null): void => {
        if (
            clientId.length === 0 ||
            itemId.length === 0 ||
            effStaff.length === 0 ||
            startsAt === null ||
            Number.isNaN(startsAt.getTime())
        ) {
            setError(strings.calendar.incompleteBooking);
            return;
        }
        setNotice(null);
        let created = 0;
        let skipped = 0;
        run(
            async () => {
                if (repeat) {
                    const result = await createSchedule(api, {
                        clientId,
                        itemId,
                        staffId: effStaff,
                        startsAt,
                        frequency,
                        interval: Math.max(1, interval),
                        count: Math.max(1, count),
                    });
                    created = result.created;
                    skipped = result.skipped;
                } else {
                    await createBooking(api, { clientId, itemId, staffId: effStaff, startsAt });
                }
            },
            {
                onSuccess: () => {
                    setClientId("");
                    setItemId("");
                    // A clean series closes; one that skipped occurrences stays open with a notice.
                    if (repeat && skipped > 0) {
                        setNotice(strings.calendar.seriesSkippedNotice(created, skipped));
                    } else {
                        onCreated();
                    }
                },
                errorMessage: repeat
                    ? strings.calendar.createSeriesError
                    : strings.calendar.bookError,
            },
        );
    };

    return {
        clients,
        items,
        staff,
        clientId,
        setClientId,
        itemId,
        setItemId,
        staffId,
        setStaffId,
        effStaff,
        repeat,
        setRepeat,
        frequency,
        setFrequency,
        interval,
        setInterval,
        count,
        setCount,
        notice,
        busy,
        error,
        submit,
    };
}
