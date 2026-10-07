import { useQuery } from "@powersync/react";
import { useMemo, useRef, useState } from "react";

import { type ApiLike, newIdempotencyKey } from "../api";
import {
    addDays,
    dateKey,
    formatTime,
    formatWeekday,
    parseTimestamp,
    sameDay,
    startOfDay,
    weekdayDay,
} from "../datetime";
import { firstName } from "../format";
import { type Load, useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { Intent, OccurrenceRow } from "../ui";
import type { Viewer } from "./auth";
import {
    type Availability,
    CLIENT_PETS_SQL,
    type CalendarEvent,
    slotProblem,
    useAvailability,
    useNow,
    useScheduleEvents,
} from "./bookings";
import { bookableItems, useCatalogItems } from "./catalog";
import { useClients } from "./clients";
import { canManagePayments } from "./payments";
import { type StaffRow, staffName, useStaff } from "./staff";
import { useReplicaLoad } from "./sync";

const s = strings.recurrences;
const MIN = 60_000;
const MAX_VISITS = 60;

export type SeriesFrequency = "week" | "month";
export type SeriesEnd = "count" | "until";
type OccurrenceStatus =
    "booked" | "moved" | "skipped" | "conflict" | "done" | "missed" | "canceled";

interface SeriesOccurrence {
    key: string;
    index: number;
    start: Date;
    end: Date;
    status: OccurrenceStatus;
    problem: string | null;
    suggestion: Date | null;
    past: boolean;
}

interface Ctx {
    avail: Availability;
    events: readonly CalendarEvent[];
    staff: Map<string, StaffRow>;
    now: Date;
}

const nthWeekday = (d: Date): number => Math.ceil(d.getDate() / 7);

export function stepDate(
    from: Date,
    frequency: SeriesFrequency,
    interval: number,
    i: number,
): Date {
    if (frequency === "week") {
        return new Date(
            from.getFullYear(),
            from.getMonth(),
            from.getDate() + 7 * interval * i,
            from.getHours(),
            from.getMinutes(),
        );
    }
    // Monthly keeps the weekday: the 2nd Tuesday stays the 2nd Tuesday, as the server books it.
    const n = nthWeekday(from);
    const target = new Date(
        from.getFullYear(),
        from.getMonth() + interval * i,
        1,
        from.getHours(),
        from.getMinutes(),
    );
    const shift = (from.getDay() - target.getDay() + 7) % 7;
    let day = 1 + shift + (n - 1) * 7;
    const days = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    while (day > days) day -= 7;
    target.setDate(day);
    return target;
}

/** Why a series visit can't go here, in the words the composer uses, or null. */
export function problemAt(
    ctx: Ctx,
    staffId: string,
    start: Date,
    end: Date,
    ignore: (id: string) => boolean,
): string | null {
    const member = ctx.staff.get(staffId);
    const name = member ? firstName(staffName(member)) : "";
    const events = ctx.events.filter((e) => !ignore(e.id));
    const found = slotProblem(ctx.avail, events, ctx.staff, staffId, start, end, null);
    switch (found.problem) {
        case "closed":
            return s.closed(ctx.avail.away(staffId, start, end)?.label ?? "");
        case "time_off":
            return s.away(name, ctx.avail.away(staffId, start, end)?.label ?? "");
        case "off_hours": {
            const w = ctx.avail.windows(staffId, start);
            return w !== null && w.length === 0
                ? s.notWorking(name, formatWeekday(start))
                : s.outsideHours(name);
        }
        case "overlap": {
            const overlaps = events.filter(
                (e) =>
                    e.staffId === staffId &&
                    e.status !== "canceled" &&
                    e.start < end &&
                    e.end > start,
            );
            // a no-show still holds its slot on the server, so it is named only when nothing else clashes
            const clash = overlaps.find((e) => e.status !== "no_show") ?? overlaps[0];
            return s.taken(name, clash ? formatTime(clash.start) : "");
        }
        default:
            return null;
    }
}

export function suggest(
    ctx: Ctx,
    staffId: string,
    start: Date,
    durationMin: number,
    ignore: (id: string) => boolean,
): Date | null {
    for (const delta of [60, -60, 30, -30, 120, -120, 180]) {
        const t = new Date(start.getTime() + delta * MIN);
        if (!sameDay(t, start)) continue;
        if (problemAt(ctx, staffId, t, new Date(t.getTime() + durationMin * MIN), ignore) === null)
            return t;
    }
    return null;
}

interface PatternInput {
    first: Date;
    frequency: SeriesFrequency;
    interval: number;
    end: SeriesEnd;
    count: number;
    until: Date;
    staffId: string;
    durationMin: number;
    ignore?: (eventId: string) => boolean;
}

export function buildOccurrences(p: PatternInput, ctx: Ctx): SeriesOccurrence[] {
    const ignore = p.ignore ?? (() => false);
    const limit = p.end === "count" ? Math.min(p.count, MAX_VISITS) : MAX_VISITS;
    const out: SeriesOccurrence[] = [];
    for (let i = 0; i < limit; i++) {
        const start = stepDate(p.first, p.frequency, p.interval, i);
        if (p.end === "until" && start >= addDays(startOfDay(p.until), 1)) break;
        const end = new Date(start.getTime() + p.durationMin * MIN);
        const past = start < ctx.now;
        const problem = past ? null : problemAt(ctx, p.staffId, start, end, ignore);
        out.push({
            key: dateKey(start),
            index: i + 1,
            start,
            end,
            status: past ? "done" : problem !== null ? "conflict" : "booked",
            problem,
            suggestion:
                problem !== null ? suggest(ctx, p.staffId, start, p.durationMin, ignore) : null,
            past,
        });
    }
    return out;
}

export function patternLabel(frequency: SeriesFrequency, interval: number, start: Date): string {
    const day = start.toLocaleDateString("en-CA", { weekday: "long" });
    if (frequency === "month")
        return s.patternMonthly(interval, s.ordinal(nthWeekday(start)), day, formatTime(start));
    return s.patternWeekly(interval, day, formatTime(start));
}

interface OccurrenceView extends SeriesOccurrence {
    dateLabel: string;
    timeLabel: string;
    choice: "shift" | "skip" | null;
    finalStart: Date;
}

export interface SeriesComposer {
    clientId: string;
    setClientId: (id: string) => void;
    clientOptions: { key: string; label: string }[];
    petName: string | null;
    itemId: string;
    setItemId: (id: string) => void;
    serviceOptions: { key: string; label: string }[];
    staffId: string;
    setStaffId: (id: string) => void;
    staffOptions: { key: string; label: string }[];
    firstDay: string;
    setFirstDay: (key: string) => void;
    time: string;
    setTime: (hhmm: string) => void;
    timeOptions: { key: string; label: string }[];
    frequency: SeriesFrequency;
    setFrequency: (f: SeriesFrequency) => void;
    interval: number;
    setInterval: (n: number) => void;
    end: SeriesEnd;
    setEnd: (e: SeriesEnd) => void;
    count: number;
    setCount: (n: number) => void;
    until: string;
    setUntil: (key: string) => void;
    oneConfirmation: boolean;
    setOneConfirmation: (v: boolean) => void;
    pattern: string;
    occurrences: OccurrenceView[];
    resolve: (key: string, choice: "shift" | "skip") => void;
    counts: { booked: number; moved: number; skipped: number; open: number };
    summary: string;
    ready: boolean;
    canSubmit: boolean;
    busy: boolean;
    error: string | null;
    done: { created: number; skipped: number; clientName: string; oneConfirmation: boolean } | null;
    submit: () => void;
    reset: () => void;
}

const TIMES = Array.from({ length: 25 }, (_, i) => {
    const m = 7 * 60 + i * 30;
    const key = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    return { key, label: formatTime(new Date(2000, 0, 1, Math.floor(m / 60), m % 60)) };
});

const parseKey = (key: string, hhmm = "00:00"): Date => {
    const [y = 2026, mo = 1, d = 1] = key.split("-").map(Number);
    const [h = 0, mi = 0] = hhmm.split(":").map(Number);
    return new Date(y, mo - 1, d, h, mi);
};

function useSeriesContext(from: Date, to: Date): Ctx & { sources: { isLoading: boolean }[] } {
    const now = useNow();
    const { events, isLoading } = useScheduleEvents(from, to);
    const avail = useAvailability(from, to);
    const staff = useStaff();
    const byId = useMemo(
        () => new Map(staff.filter((x) => x.status === "active").map((x) => [x.id, x])),
        [staff],
    );
    return { avail, events, staff: byId, now, sources: [{ isLoading }, ...avail.sources] };
}

/** A new series with its dates laid out as you type; every clash gets a suggested time or a skip. */
export function useSeriesComposer(api: ApiLike, viewer: Viewer | null): SeriesComposer {
    const clients = useClients();
    const pets = useQuery<{ id: string; client_id: string; name: string }>(CLIENT_PETS_SQL).data;
    const services = bookableItems(useCatalogItems()).filter((i) => i.kind === "service");
    const staffRows = useStaff().filter((x) => x.status === "active");
    const manager = viewer !== null && canManagePayments(viewer.role);
    const staffChoices = staffRows.filter((x) => manager || x.id === viewer?.staffId);
    const today = startOfDay(new Date());
    const [clientId, setClientId] = useState("");
    const [itemId, setItemId] = useState("");
    const [staffId, setStaffId] = useState(viewer?.staffId ?? "");
    const [firstDay, setFirstDay] = useState(dateKey(addDays(today, 1)));
    const [time, setTime] = useState("10:00");
    const [frequency, setFrequency] = useState<SeriesFrequency>("week");
    const [interval, setInterval] = useState(4);
    const [end, setEnd] = useState<SeriesEnd>("count");
    const [count, setCount] = useState(6);
    const [until, setUntil] = useState(dateKey(addDays(today, 120)));
    const [oneConfirmation, setOneConfirmation] = useState(true);
    const [choices, setChoices] = useState<Record<string, "shift" | "skip">>({});
    const [done, setDone] = useState<SeriesComposer["done"]>(null);
    const { busy, error, setError, run } = useAsyncAction();
    const key = useRef<string | null>(null);
    const ctx = useSeriesContext(today, addDays(today, 730));

    const item = services.find((i) => i.id === itemId);
    const start = parseKey(firstDay, time);
    const ready = clientId !== "" && itemId !== "" && staffId !== "";
    const raw = ready
        ? buildOccurrences(
              {
                  first: start,
                  frequency,
                  interval: Math.max(1, interval),
                  end,
                  count: Math.max(1, count),
                  until: parseKey(until),
                  staffId,
                  durationMin: item?.duration_min ?? 60,
              },
              ctx,
          )
        : [];
    const occurrences: OccurrenceView[] = raw.map((o) => {
        const choice =
            o.status === "conflict" ? (choices[o.key] ?? (o.suggestion ? "shift" : "skip")) : null;
        const finalStart = choice === "shift" && o.suggestion ? o.suggestion : o.start;
        return {
            ...o,
            status: choice === "shift" ? "moved" : choice === "skip" ? "skipped" : o.status,
            choice,
            finalStart,
            dateLabel: weekdayDay(o.start),
            timeLabel: formatTime(finalStart),
        };
    });
    const counts = {
        booked: occurrences.filter((o) => o.status === "booked" || o.status === "moved").length,
        moved: occurrences.filter((o) => o.status === "moved").length,
        skipped: occurrences.filter((o) => o.status === "skipped").length,
        open: occurrences.filter((o) => o.status === "conflict").length,
    };
    const fmt = (d: Date): string =>
        d.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
    const pattern = patternLabel(frequency, Math.max(1, interval), start);
    const first = occurrences[0];
    const last = occurrences.at(-1);
    const clientName = clients.find((c) => c.id === clientId)?.name ?? "";
    const pet = pets.find((p) => p.client_id === clientId) ?? null;
    const reset = (): void => {
        setDone(null);
        setChoices({});
        key.current = null;
    };

    return {
        clientId,
        setClientId,
        clientOptions: clients
            .filter((c) => c.status === "active")
            .map((c) => ({ key: c.id, label: c.name })),
        petName: pet?.name ?? null,
        itemId,
        setItemId,
        serviceOptions: services.map((i) => ({ key: i.id, label: i.name })),
        staffId,
        setStaffId,
        staffOptions: staffChoices.map((x) => ({ key: x.id, label: staffName(x) })),
        firstDay,
        setFirstDay,
        time,
        setTime,
        timeOptions: TIMES,
        frequency,
        setFrequency,
        interval,
        setInterval,
        end,
        setEnd,
        count,
        setCount,
        until,
        setUntil,
        oneConfirmation,
        setOneConfirmation,
        pattern,
        occurrences,
        resolve: (k, choice) => {
            setChoices((c) => ({ ...c, [k]: choice }));
        },
        counts,
        summary:
            first && last
                ? s.summary(counts.booked, pattern, fmt(first.start), fmt(last.start))
                : "",
        ready,
        canSubmit: ready && counts.booked > 0 && counts.open === 0,
        busy,
        error,
        done,
        submit: () => {
            if (!ready || counts.booked === 0) {
                setError(s.nothingToBook);
                return;
            }
            key.current ??= newIdempotencyKey();
            const idempotencyKey = key.current;
            run(
                async () => {
                    const out = await api.post<{ created: number; skipped: number }>(
                        "/v1/recurrences",
                        {
                            client_id: clientId,
                            item_id: itemId,
                            staff_id: staffId,
                            subject_id: pet?.id ?? null,
                            starts_at: start.toISOString(),
                            frequency,
                            interval: Math.max(1, interval),
                            monthly_by: "weekday",
                            count: end === "count" ? Math.max(1, count) : null,
                            until: end === "until" ? until : null,
                            exceptions: occurrences
                                .filter((o) => o.choice !== null)
                                .map((o) =>
                                    o.choice === "skip"
                                        ? { date: o.key, action: "skip" }
                                        : {
                                              date: o.key,
                                              action: "shift",
                                              starts_at: o.finalStart.toISOString(),
                                          },
                                ),
                            confirmation: oneConfirmation ? "series" : "each",
                        },
                        { idempotencyKey },
                    );
                    setDone({
                        created: out.created,
                        skipped: out.skipped - counts.skipped,
                        clientName,
                        oneConfirmation,
                    });
                },
                { errorMessage: s.createError },
            );
        },
        reset,
    };
}

interface SeriesRow {
    id: string;
    item_id: string;
    staff_id: string | null;
    client_id: string | null;
    frequency: string;
    interval: number;
    count: number | null;
    until: string | null;
    status: string;
    item_name: string;
    item_color: string | null;
    duration_min: number | null;
    deposit_type: string;
    client_name: string | null;
}

interface SeriesVisitRow {
    slot_id: string;
    recurrence_id: string;
    starts_at: string;
    ends_at: string;
    staff_id: string;
    booking_id: string | null;
    status: string | null;
    deposit_status: string | null;
    pet_name: string | null;
}

export const SERIES_SQL = `
SELECT r.id, r.item_id, r.staff_id, r.client_id, r.frequency, r.interval, r.count, r.until, r.status,
       i.name AS item_name, i.color AS item_color, i.duration_min, i.deposit_type,
       c.name AS client_name
FROM recurrences r JOIN items i ON i.id = r.item_id JOIN clients c ON c.id = r.client_id`;

export const SERIES_VISITS_SQL = `
SELECT s.id AS slot_id, s.recurrence_id, s.starts_at, s.ends_at, s.staff_id, b.id AS booking_id,
       b.status, b.deposit_status, sj.name AS pet_name
FROM slots s JOIN recurrences r ON r.id = s.recurrence_id AND r.client_id IS NOT NULL
LEFT JOIN bookings b ON b.slot_id = s.id AND b.deleted_at IS NULL
LEFT JOIN subjects sj ON sj.id = b.subject_id
ORDER BY s.starts_at`;

interface SeriesDate extends SeriesOccurrence {
    dateLabel: string;
    timeLabel: string;
    bookingId: string | null;
    staffId: string;
}

interface SeriesSummary {
    id: string;
    clientName: string;
    petName: string;
    serviceName: string;
    serviceColor: string | null;
    staffId: string;
    staffName: string;
    pattern: string;
    progress: string;
    ratio: number | null;
    next: Date | null;
    nextLabel: string;
    endsLabel: string;
    attention: number;
    ending: boolean;
    status: string;
}

export function datesOf(row: SeriesRow, visits: SeriesVisitRow[], ctx: Ctx): SeriesDate[] {
    const mine = visits.filter((v) => v.recurrence_id === row.id);
    const ids = new Set(mine.map((v) => v.booking_id ?? v.slot_id));
    return mine.map((v, i) => {
        const start = parseTimestamp(v.starts_at);
        const end = parseTimestamp(v.ends_at);
        const past = end <= ctx.now;
        const st = v.status ?? "canceled";
        const live = st === "confirmed" || st === "pending";
        const problem =
            live && !past ? problemAt(ctx, v.staff_id, start, end, (id) => ids.has(id)) : null;
        const status: OccurrenceStatus =
            st === "canceled"
                ? "canceled"
                : st === "no_show"
                  ? "missed"
                  : st === "completed" || past
                    ? "done"
                    : problem !== null
                      ? "conflict"
                      : "booked";
        return {
            key: v.slot_id,
            index: i + 1,
            start,
            end,
            status,
            problem,
            suggestion: null,
            past,
            dateLabel: weekdayDay(start),
            timeLabel: formatTime(start),
            bookingId: v.booking_id,
            staffId: v.staff_id,
        };
    });
}

export function summarize(
    row: SeriesRow,
    dates: SeriesDate[],
    staff: Map<string, StaffRow>,
    now: Date,
    petName: string,
): SeriesSummary {
    const live = dates.filter((d) => d.status !== "canceled");
    const next = live.find((d) => !d.past) ?? null;
    const doneCount = live.filter((d) => d.past).length;
    const remaining = live.length - doneCount;
    const last = live.at(-1);
    const firstDate = dates[0]?.start ?? now;
    const member = row.staff_id !== null ? staff.get(row.staff_id) : undefined;
    return {
        id: row.id,
        clientName: row.client_name ?? "",
        petName,
        serviceName: row.item_name,
        serviceColor: row.item_color,
        staffId: row.staff_id ?? "",
        staffName: member ? staffName(member) : "",
        pattern: patternLabel(
            row.frequency === "month" ? "month" : "week",
            row.interval,
            next?.start ?? firstDate,
        ),
        progress: s.progress(doneCount, live.length),
        ratio: live.length > 0 ? doneCount / live.length : null,
        next: next?.start ?? null,
        nextLabel: next
            ? sameDay(next.start, now)
                ? s.todayAt(formatTime(next.start))
                : `${weekdayDay(next.start)}, ${formatTime(next.start)}`
            : s.noneLeft,
        endsLabel: last
            ? s.endsOn(
                  last.start.toLocaleDateString("en-CA", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                  }),
                  remaining,
              )
            : s.noneLeft,
        attention: dates.filter((d) => d.status === "conflict").length,
        ending: remaining === 1,
        status: row.status,
    };
}

type SeriesFilter = "all" | "attention" | "ending";

interface SeriesList {
    rows: SeriesSummary[];
    q: string;
    setQ: (q: string) => void;
    filter: SeriesFilter;
    setFilter: (f: SeriesFilter) => void;
    counts: { all: number; attention: number; ending: number };
    load: Load;
}

function useSeriesData(): {
    series: SeriesRow[];
    visits: SeriesVisitRow[];
    ctx: Ctx;
    sources: { isLoading: boolean }[];
} {
    const series = useQuery<SeriesRow>(SERIES_SQL);
    const visits = useQuery<SeriesVisitRow>(SERIES_VISITS_SQL);
    const today = startOfDay(new Date());
    const ctx = useSeriesContext(addDays(today, -1), addDays(today, 730));
    return {
        series: series.data,
        visits: visits.data,
        ctx,
        sources: [series, visits, ...ctx.sources],
    };
}

/** Every series with its progress and next visit, filtered to the ones needing a decision or ending. */
export function useSeriesList(): SeriesList {
    const { series, visits, ctx, sources } = useSeriesData();
    const [q, setQ] = useState("");
    const [filter, setFilter] = useState<SeriesFilter>("all");
    const all = series
        .filter((r) => r.status !== "canceled")
        .map((r) => {
            const dates = datesOf(r, visits, ctx);
            const pet =
                visits.find((v) => v.recurrence_id === r.id && v.pet_name !== null)?.pet_name ?? "";
            return summarize(r, dates, ctx.staff, ctx.now, pet);
        })
        .filter((r) => r.next !== null);
    const t = q.trim().toLowerCase();
    const load = useReplicaLoad(sources, all.length === 0);
    return {
        rows: all
            .filter((r) =>
                filter === "attention" ? r.attention > 0 : filter === "ending" ? r.ending : true,
            )
            .filter(
                (r) =>
                    t === "" ||
                    [r.clientName, r.petName, r.serviceName].some((v) =>
                        v.toLowerCase().includes(t),
                    ),
            )
            .sort((a, b) => +(a.next ?? 0) - +(b.next ?? 0)),
        q,
        setQ,
        filter,
        setFilter,
        counts: {
            all: all.length,
            attention: all.filter((r) => r.attention > 0).length,
            ending: all.filter((r) => r.ending).length,
        },
        load,
    };
}

export type ChangeScope = "one" | "following" | "all";

export interface SeriesRecord {
    summary: SeriesSummary;
    dates: SeriesDate[];
    scope: ChangeScope;
    setScope: (v: ChangeScope) => void;
    weekday: string;
    setWeekday: (v: string) => void;
    time: string;
    setTime: (v: string) => void;
    staffId: string;
    setStaffId: (v: string) => void;
    weekdayOptions: { key: string; label: string }[];
    timeOptions: { key: string; label: string }[];
    staffOptions: { key: string; label: string }[];
    preview: SeriesDate[];
    changeSummary: string;
    changed: boolean;
    saveChange: () => void;
    cancelNotify: boolean;
    setCancelNotify: (v: boolean) => void;
    cancelSummary: string;
    cancelSeries: () => void;
    canceled: boolean;
    saved: string | null;
    busy: boolean;
    error: string | null;
}

const WEEKDAY_KEYS = ["1", "2", "3", "4", "5", "6", "0"];
const dayName = (k: string): string =>
    new Date(2026, 9, 4 + Number(k)).toLocaleDateString("en-CA", { weekday: "long" });

/** One series: its dates, a change to the whole series (or from one visit on) and cancelling what's left. */
export function useSeriesRecord(api: ApiLike, seriesId: string | null): SeriesRecord | null {
    const { series, visits, ctx } = useSeriesData();
    const row = series.find((x) => x.id === seriesId) ?? null;
    const dates = row ? datesOf(row, visits, ctx) : [];
    const upcoming = dates.filter(
        (d) => !d.past && (d.status === "booked" || d.status === "conflict"),
    );
    const base = upcoming[0]?.start ?? dates.at(-1)?.start ?? ctx.now;
    const [scope, setScope] = useState<ChangeScope>("following");
    const [weekday, setWeekday] = useState<string | null>(null);
    const [time, setTime] = useState<string | null>(null);
    const [staffId, setStaffId] = useState<string | null>(null);
    const [cancelNotify, setCancelNotify] = useState(true);
    const [canceled, setCanceled] = useState(false);
    const [saved, setSaved] = useState<string | null>(null);
    const { busy, error, run } = useAsyncAction();
    if (!row) return null;

    const pad = (n: number): string => String(n).padStart(2, "0");
    const wd = weekday ?? String(base.getDay());
    const tm = time ?? `${pad(base.getHours())}:${pad(base.getMinutes())}`;
    const who = staffId ?? row.staff_id ?? "";
    const [h = 0, m = 0] = tm.split(":").map(Number);
    const changed =
        wd !== String(base.getDay()) ||
        h !== base.getHours() ||
        m !== base.getMinutes() ||
        who !== (row.staff_id ?? "");
    const ids = new Set(dates.map((d) => d.bookingId ?? d.key));
    const inScope = scope === "one" ? upcoming.slice(0, 1) : upcoming;
    const preview: SeriesDate[] = inScope.map((d) => {
        const shift = (Number(wd) - d.start.getDay() + 7) % 7;
        const offset = shift > 3 ? shift - 7 : shift;
        const start = new Date(
            d.start.getFullYear(),
            d.start.getMonth(),
            d.start.getDate() + offset,
            h,
            m,
        );
        const end = new Date(start.getTime() + (d.end.getTime() - d.start.getTime()));
        const problem = problemAt(ctx, who, start, end, (id) => ids.has(id));
        return {
            ...d,
            start,
            end,
            status: problem !== null ? "conflict" : "booked",
            problem,
            dateLabel: weekdayDay(start),
            timeLabel: formatTime(start),
        };
    });
    const conflicts = preview.filter((o) => o.status === "conflict").length;
    const member = ctx.staff.get(who);
    const pet =
        visits.find((v) => v.recurrence_id === row.id && v.pet_name !== null)?.pet_name ?? "";
    const hasDeposit = row.deposit_type !== "none";
    const fromKey = upcoming[0] ? dateKey(upcoming[0].start) : null;
    const weekdayIndex = (Number(wd) + 6) % 7;

    return {
        summary: summarize(row, dates, ctx.staff, ctx.now, pet),
        dates: canceled
            ? dates.map((d) => (d.past ? d : { ...d, status: "canceled" as const }))
            : dates,
        scope,
        setScope,
        weekday: wd,
        setWeekday,
        time: tm,
        setTime,
        staffId: who,
        setStaffId,
        weekdayOptions: WEEKDAY_KEYS.map((k) => ({ key: k, label: dayName(k) })),
        timeOptions: TIMES,
        staffOptions: [...ctx.staff.values()].map((x) => ({ key: x.id, label: staffName(x) })),
        preview,
        changeSummary: !changed
            ? s.noChange
            : s.changeSummary(
                  preview.length,
                  dayName(wd),
                  formatTime(new Date(2000, 0, 1, h, m)),
                  member ? firstName(staffName(member)) : "",
                  conflicts,
              ),
        changed,
        saveChange: () => {
            setSaved(null);
            run(
                async () => {
                    const out = await api.patch<{ moved: string[]; skipped: unknown[] }>(
                        `/v1/recurrences/${row.id}`,
                        {
                            scope,
                            from: scope === "all" ? null : fromKey,
                            weekday: weekdayIndex,
                            time: tm,
                            staff_id: who === "" ? null : who,
                        },
                    );
                    setSaved(s.changeSaved(out.moved.length, out.skipped.length));
                },
                { errorMessage: s.changeError },
            );
        },
        cancelNotify,
        setCancelNotify,
        cancelSummary: upcoming[0]
            ? s.cancelSummary(upcoming.length, weekdayDay(upcoming[0].start), hasDeposit)
            : s.noneLeft,
        cancelSeries: () => {
            run(
                () =>
                    api.post(`/v1/recurrences/${row.id}/cancel`, {
                        from: fromKey,
                        notify: cancelNotify,
                    }),
                {
                    onSuccess: () => {
                        setCanceled(true);
                    },
                    errorMessage: s.cancelError,
                },
            );
        },
        canceled,
        saved,
        busy,
        error,
    };
}

const STATE: Record<OccurrenceStatus, { intent: Intent; label: string }> = {
    booked: { intent: "accent", label: s.stateBooked },
    moved: { intent: "warning", label: s.stateMoved },
    skipped: { intent: "neutral", label: s.stateSkipped },
    conflict: { intent: "danger", label: s.stateConflict },
    done: { intent: "success", label: s.stateDone },
    missed: { intent: "danger", label: s.stateMissed },
    canceled: { intent: "neutral", label: s.stateCanceled },
};

/** The row an OccurrenceList draws; a clash in the composer offers its suggested time and a skip. */
export function occurrenceRow(
    o: SeriesOccurrence & {
        dateLabel: string;
        timeLabel: string;
        choice?: "shift" | "skip" | null;
    },
): OccurrenceRow {
    const planning = o.choice !== undefined;
    const st =
        o.status === "booked" && !planning
            ? { intent: "accent" as const, label: s.stateScheduled }
            : STATE[o.status];
    const decidable = o.choice !== undefined && o.choice !== null;
    return {
        key: o.key,
        index: o.index,
        date: o.dateLabel,
        time: o.timeLabel,
        intent: st.intent,
        state: st.label,
        note: o.status === "done" || o.status === "canceled" ? null : o.problem,
        past: o.past,
        actions: decidable
            ? [
                  ...(o.suggestion
                      ? [
                            {
                                key: "shift",
                                label: s.moveTo(formatTime(o.suggestion)),
                                selected: o.choice === "shift",
                            },
                        ]
                      : []),
                  { key: "skip", label: s.skip, selected: o.choice === "skip" },
              ]
            : undefined,
    };
}
