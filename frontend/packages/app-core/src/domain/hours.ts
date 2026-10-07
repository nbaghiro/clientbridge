import { usePowerSync, useQuery } from "@powersync/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { type ApiLike, newIdempotencyKey, newRowId } from "../api";
import {
    addDays,
    dateKey,
    formatTime,
    formatWeekday,
    sameDay,
    startOfDay,
    startOfWeek,
    weekdayDay,
} from "../datetime";
import { initials } from "../format";
import { type Load, useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { Viewer } from "./auth";
import {
    type ScheduleBlock,
    type ScheduleEvent,
    useAvailability,
    useNow,
    useScheduleEvents,
} from "./bookings";
import { useBusinessId } from "./business";
import { canManageStaff, staffName, useStaff } from "./staff";
import { useReplicaLoad } from "./sync";

const s = strings.hours;

/** Weekday order for the editor, 0 = Monday … 6 = Sunday — matching the server's `date.weekday()`. */
const WEEKDAYS: { weekday: number; label: string; short: string }[] = [
    { weekday: 0, label: s.monday, short: s.monShort },
    { weekday: 1, label: s.tuesday, short: s.tueShort },
    { weekday: 2, label: s.wednesday, short: s.wedShort },
    { weekday: 3, label: s.thursday, short: s.thuShort },
    { weekday: 4, label: s.friday, short: s.friShort },
    { weekday: 5, label: s.saturday, short: s.satShort },
    { weekday: 6, label: s.sunday, short: s.sunShort },
];

const DEFAULT_START = "09:00";
const DEFAULT_END = "17:00";
const HHMM = /^\d{2}:\d{2}$/;

interface DayHours {
    weekday: number;
    open: boolean;
    start: string;
    end: string;
}

interface RecurringRow {
    weekday: number | null;
    start_time: string | null;
    end_time: string | null;
    available: number;
}

export const RECURRING_HOURS_SQL =
    "SELECT weekday, start_time, end_time, available FROM hours WHERE staff_id = ? AND basis = 'recurring' ORDER BY start_time";

export const CLEAR_RECURRING_HOURS_SQL =
    "DELETE FROM hours WHERE staff_id = ? AND basis = 'recurring'";

export const INSERT_RECURRING_HOURS_SQL =
    "INSERT INTO hours (id, business_id, staff_id, basis, weekday, start_time, end_time, available, note) VALUES (?, ?, ?, 'recurring', ?, ?, ?, ?, NULL)";

/** Days with no rows default to weekdays 9 to 5 and weekends closed; split days keep their span. */
export function seedDays(rows: RecurringRow[]): DayHours[] {
    return WEEKDAYS.map(({ weekday }) => {
        const mine = rows.filter((r) => r.weekday === weekday);
        if (mine.length === 0) {
            return { weekday, open: weekday < 5, start: DEFAULT_START, end: DEFAULT_END };
        }
        const open = mine.filter((r) => r.available === 1);
        return {
            weekday,
            open: open.length > 0,
            start: (open[0]?.start_time ?? DEFAULT_START).slice(0, 5),
            end: (open.at(-1)?.end_time ?? DEFAULT_END).slice(0, 5),
        };
    });
}

const toMin = (hhmm: string): number => {
    const [h = 0, m = 0] = hhmm.split(":").map(Number);
    return h * 60 + m;
};

function formatHhmm(hhmm: string): string {
    const [h = 0, m = 0] = hhmm.split(":").map(Number);
    return formatTime(new Date(2000, 0, 1, h, m));
}

/** "9:00 a.m. – 5:00 p.m.", or "9–5" when `short`. */
export function shiftLabel(start: string, end: string, short = false): string {
    if (!short) return `${formatHhmm(start)} – ${formatHhmm(end)}`;
    const fmt = (v: string): string => {
        const [h = 0, m = 0] = v.split(":").map(Number);
        const h12 = h % 12 === 0 ? 12 : h % 12;
        return m === 0 ? String(h12) : `${String(h12)}:${String(m).padStart(2, "0")}`;
    };
    return `${fmt(start)}–${fmt(end)}`;
}

interface WeekEditorDay extends DayHours {
    label: string;
    short: string;
    hours: number;
    error: string | null;
}

interface WeekEditor {
    ready: boolean;
    days: WeekEditorDay[];
    totalHours: number;
    openDays: number;
    setOpen: (weekday: number, open: boolean) => void;
    setTime: (weekday: number, which: "start" | "end", value: string) => void;
    copyToWeekdays: (weekday: number) => void;
    busy: boolean;
    error: string | null;
    saved: boolean;
    submit: () => void;
    timeOptions: { key: string; label: string }[];
}

const TIME_OPTIONS = Array.from({ length: 33 }, (_, i) => {
    const min = 6 * 60 + i * 30;
    const key = `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
    return { key, label: formatHhmm(key) };
});

/** One person's regular week, saved straight to the replica and uploaded through sync. Key it by staff id. */
export function useWeekEditor(staffId: string | null): WeekEditor {
    const db = usePowerSync();
    const businessId = useBusinessId();
    const { data, isLoading } = useQuery<RecurringRow>(RECURRING_HOURS_SQL, [staffId ?? ""]);
    const { busy, error, setError, run } = useAsyncAction();
    const [days, setDays] = useState<DayHours[] | null>(null);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        if (days === null && !isLoading && staffId !== null) setDays(seedDays(data));
    }, [days, isLoading, data, staffId]);

    const edit = (weekday: number, patch: Partial<DayHours>): void => {
        setSaved(false);
        setDays((d) => d?.map((x) => (x.weekday === weekday ? { ...x, ...patch } : x)) ?? d);
    };
    const view = (days ?? []).map((d) => ({
        ...d,
        label: WEEKDAYS[d.weekday]?.label ?? "",
        short: WEEKDAYS[d.weekday]?.short ?? "",
        hours: d.open ? Math.max(0, (toMin(d.end) - toMin(d.start)) / 60) : 0,
        error: d.open && d.start >= d.end ? s.timeOrderShort : null,
    }));

    return {
        ready: days !== null,
        days: view,
        totalHours: view.reduce((sum, d) => sum + d.hours, 0),
        openDays: view.filter((d) => d.open).length,
        setOpen: (weekday, open) => {
            edit(weekday, { open });
        },
        setTime: (weekday, which, value) => {
            edit(weekday, { [which]: value });
        },
        copyToWeekdays: (weekday) => {
            const from = days?.find((d) => d.weekday === weekday);
            if (!from) return;
            setSaved(false);
            setDays(
                (d) =>
                    d?.map((x) =>
                        x.weekday === weekday || x.weekday > 4
                            ? x
                            : { ...x, open: true, start: from.start, end: from.end },
                    ) ?? d,
            );
        },
        busy,
        error,
        saved,
        submit: () => {
            if (days === null || staffId === null) return;
            if (businessId === null) {
                setError(strings.common.stillSyncing);
                return;
            }
            for (const d of days) {
                if (!d.open) continue;
                if (!HHMM.test(d.start) || !HHMM.test(d.end)) {
                    setError(s.timeFormatError);
                    return;
                }
                if (d.start >= d.end) {
                    setError(s.timeOrderError);
                    return;
                }
            }
            run(
                async () => {
                    await db.writeTransaction(async (tx) => {
                        await tx.execute(CLEAR_RECURRING_HOURS_SQL, [staffId]);
                        for (const d of days) {
                            await tx.execute(INSERT_RECURRING_HOURS_SQL, [
                                newRowId("av"),
                                businessId,
                                staffId,
                                d.weekday,
                                d.open ? `${d.start}:00` : null,
                                d.open ? `${d.end}:00` : null,
                                d.open ? 1 : 0,
                            ]);
                        }
                    });
                },
                {
                    onSuccess: () => {
                        setSaved(true);
                    },
                    errorMessage: s.saveError,
                },
            );
        },
        timeOptions: TIME_OPTIONS,
    };
}

export interface AwayEntry {
    id: string;
    staffId: string | null;
    who: string;
    reason: string;
    start: Date;
    end: Date;
    allDay: boolean;
    when: string;
    // Visits booked inside it that still need moving.
    affected: number;
    past: boolean;
}

export type WeekCell =
    | { kind: "shift"; label: string; partial: string | null }
    | { kind: "off" }
    | { kind: "unset" }
    | { kind: "away"; label: string }
    | { kind: "closed"; label: string };

export interface TeamHoursMember {
    id: string;
    name: string;
    title: string;
    color: string | null;
    initials: string;
    weeklyHours: number;
    cells: WeekCell[];
    away: AwayEntry[];
    editable: boolean;
}

interface TeamWeek {
    load: Load;
    days: {
        key: string;
        date: Date;
        weekday: string;
        dayNumber: number;
        isToday: boolean;
        closure: AwayEntry | null;
    }[];
    label: string;
    shift: (dir: 1 | -1) => void;
    members: TeamHoursMember[];
    closures: AwayEntry[];
    timeOff: AwayEntry[];
    canClose: boolean;
    removeAway: (id: string) => void;
    removing: string | null;
    removeError: string | null;
}

function whenLabel(start: Date, end: Date, allDay: boolean): string {
    if (allDay) {
        const last = addDays(end, -1);
        return sameDay(start, last)
            ? weekdayDay(start)
            : `${weekdayDay(start)} – ${weekdayDay(last)}`;
    }
    return `${weekdayDay(start)}, ${formatTime(start)} – ${formatTime(end)}`;
}

const isAllDay = (start: Date, end: Date): boolean =>
    start.getHours() === 0 &&
    start.getMinutes() === 0 &&
    end.getHours() === 0 &&
    end.getMinutes() === 0;

const live = (e: ScheduleEvent): boolean => e.status === "confirmed" || e.status === "pending";

export function affectedBy(
    events: readonly ScheduleEvent[],
    staffId: string | null,
    start: Date,
    end: Date,
): ScheduleEvent[] {
    return events.filter(
        (e) =>
            (staffId === null || e.staffId === staffId) &&
            e.start < end &&
            e.end > start &&
            live(e),
    );
}

function toAway(
    b: ScheduleBlock,
    names: Map<string, string>,
    events: readonly ScheduleEvent[],
    now: Date,
): AwayEntry {
    const allDay = isAllDay(b.start, b.end);
    return {
        id: b.id,
        staffId: b.staffId,
        who: b.staffId === null ? s.everyone : (names.get(b.staffId) ?? ""),
        reason: b.label,
        start: b.start,
        end: b.end,
        allDay,
        when: whenLabel(b.start, b.end, allDay),
        affected: affectedBy(events, b.staffId, b.start, b.end).length,
        past: b.end <= now,
    };
}

const AHEAD_DAYS = 120;

/** The team's week: each person's shift per day, with time off and closures laid over it. */
export function useTeamWeek(api: ApiLike, viewer: Viewer | null): TeamWeek {
    const now = useNow();
    const today = startOfDay(now);
    const [anchor, setAnchor] = useState(() => startOfWeek(today));
    const horizon = addDays(today, AHEAD_DAYS);
    const until = horizon > addDays(anchor, 7) ? horizon : addDays(anchor, 7);
    const from = anchor < today ? anchor : today;
    const avail = useAvailability(from, until);
    const { events, ...eventsLoad } = useScheduleEvents(from, until);
    const staffRows = useStaff();
    const hours = useQuery<RecurringRow & { staff_id: string }>(
        "SELECT staff_id, weekday, start_time, end_time, available FROM hours WHERE basis = 'recurring'",
    );
    const remover = useAsyncAction();
    const [removing, setRemoving] = useState<string | null>(null);
    const manager = viewer !== null && canManageStaff(viewer.role);
    const members = staffRows.filter(
        (m) => m.status === "active" && (manager || m.id === viewer?.staffId),
    );
    const names = new Map(members.map((m) => [m.id, staffName(m)]));
    const away = avail.awayRows.map((b) => toAway(b, names, events, now));
    const cols = Array.from({ length: 7 }, (_, i) => addDays(anchor, i));
    const days = cols.map((date) => ({
        key: dateKey(date),
        date,
        weekday: formatWeekday(date),
        dayNumber: date.getDate(),
        isToday: sameDay(date, now),
        closure: away.find((a) => a.staffId === null && a.start <= date && a.end > date) ?? null,
    }));
    const rowsFor = (id: string): RecurringRow[] => hours.data.filter((h) => h.staff_id === id);
    const load = useReplicaLoad([hours, eventsLoad, ...avail.sources], hours.data.length === 0);

    return {
        load,
        days,
        label: `${weekdayDay(cols[0] ?? anchor)} – ${weekdayDay(cols[6] ?? anchor)}`,
        shift: (dir) => {
            setAnchor((a) => addDays(a, dir * 7));
        },
        members: members.map((m) => {
            const rows = rowsFor(m.id);
            const name = staffName(m);
            return {
                id: m.id,
                name,
                title: m.title ?? "",
                color: m.color,
                initials: initials(name),
                weeklyHours: rows
                    .filter(
                        (r) => r.available === 1 && r.start_time !== null && r.end_time !== null,
                    )
                    .reduce(
                        (sum, r) =>
                            sum + (toMin(r.end_time ?? "") - toMin(r.start_time ?? "")) / 60,
                        0,
                    ),
                cells: days.map((d): WeekCell => {
                    if (d.closure) return { kind: "closed", label: d.closure.reason };
                    const dayEnd = addDays(d.date, 1);
                    const mine = away.filter(
                        (a) => a.staffId === m.id && a.start < dayEnd && a.end > d.date,
                    );
                    const full = mine.find((a) => a.start <= d.date && a.end >= dayEnd);
                    if (full) return { kind: "away", label: full.reason };
                    const w = avail.windows(m.id, d.date);
                    if (w === null) return { kind: "unset" };
                    const first = w[0];
                    const last = w.at(-1);
                    if (first === undefined || last === undefined) return { kind: "off" };
                    const part = mine[0];
                    const hhmm = (x: Date): string =>
                        `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`;
                    return {
                        kind: "shift",
                        label: shiftLabel(hhmm(first.start), hhmm(last.end), true),
                        partial: part ? `${formatTime(part.start)} ${part.reason}` : null,
                    };
                }),
                away: away.filter((a) => a.staffId === m.id && !a.past),
                editable: manager || m.id === viewer?.staffId,
            };
        }),
        closures: away.filter((a) => a.staffId === null && !a.past),
        timeOff: away
            .filter((a) => a.staffId !== null && !a.past && names.has(a.staffId))
            .sort((a, b) => +a.start - +b.start),
        canClose: manager,
        removeAway: (id) => {
            setRemoving(id);
            remover.run(() => api.delete(`/v1/time-off/${id}`), {
                onSuccess: () => {
                    setRemoving(null);
                },
                errorMessage: s.removeError,
            });
        },
        removing: remover.busy ? removing : null,
        removeError: remover.error,
    };
}

export type AwayLength = "day" | "days" | "week" | "part";

interface TimeOffForm {
    // "" closes the whole business.
    staffId: string;
    setStaffId: (id: string) => void;
    staffOptions: { key: string; label: string }[];
    length: AwayLength;
    setLength: (l: AwayLength) => void;
    from: string;
    setFrom: (key: string) => void;
    to: string;
    setTo: (key: string) => void;
    startTime: string;
    setStartTime: (v: string) => void;
    endTime: string;
    setEndTime: (v: string) => void;
    reason: string;
    setReason: (v: string) => void;
    summary: string;
    affected: ScheduleEvent[];
    affectedNote: string | null;
    canSubmit: boolean;
    busy: boolean;
    error: string | null;
    submit: () => void;
    timeOptions: { key: string; label: string }[];
    pickerDays: (
        offset: number,
    ) => { key: string; weekday: string; day: string; closed: boolean; isToday: boolean }[];
}

const parseKey = (key: string): Date => {
    const [y = 2026, m = 1, d = 1] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
};

/** Time off for one person, or a closure for everyone; lists the visits it would leave without a groomer. */
export function useTimeOffForm(
    api: ApiLike,
    viewer: Viewer | null,
    onDone: () => void,
    initialStaffId: string,
): TimeOffForm {
    const now = useNow();
    const staffRows = useStaff();
    const manager = viewer !== null && canManageStaff(viewer.role);
    const [staffId, setStaffId] = useState(initialStaffId);
    const [length, setLength] = useState<AwayLength>("day");
    const [from, setFrom] = useState(dateKey(addDays(now, 1)));
    const [to, setTo] = useState(dateKey(addDays(now, 1)));
    const [startTime, setStartTime] = useState("10:00");
    const [endTime, setEndTime] = useState("12:00");
    const [reason, setReason] = useState("");
    const { busy, error, setError, run } = useAsyncAction();
    const key = useRef<string | null>(null);

    const start = parseKey(from);
    if (length === "part") {
        const [h = 0, m = 0] = startTime.split(":").map(Number);
        start.setHours(h, m);
    }
    const lastDay =
        length === "day" || length === "part"
            ? parseKey(from)
            : length === "week"
              ? addDays(parseKey(from), 6)
              : parseKey(to);
    let end = addDays(lastDay, 1);
    if (length === "part") {
        const [h = 0, m = 0] = endTime.split(":").map(Number);
        end = new Date(parseKey(from).setHours(h, m));
    }
    const valid = end > start;
    const range = useMemo(
        () => ({ from: startOfDay(now), to: addDays(startOfDay(now), 400) }),
        [now],
    );
    const { events } = useScheduleEvents(range.from, range.to);
    const avail = useAvailability(range.from, range.to);
    const affected = valid ? affectedBy(events, staffId === "" ? null : staffId, start, end) : [];
    const members = staffRows.filter(
        (m) => m.status === "active" && (manager || m.id === viewer?.staffId),
    );
    const who =
        staffId === ""
            ? s.everyone
            : staffName(
                  members.find((m) => m.id === staffId) ?? { name: null, title: null, role: "" },
              );

    return {
        staffId,
        setStaffId,
        staffOptions: [
            ...members.map((m) => ({ key: m.id, label: staffName(m) })),
            ...(manager ? [{ key: "", label: s.wholeBusiness }] : []),
        ],
        length,
        setLength,
        from,
        setFrom: (k) => {
            setFrom(k);
            if (parseKey(to) < parseKey(k)) setTo(k);
        },
        to,
        setTo,
        startTime,
        setStartTime,
        endTime,
        setEndTime,
        reason,
        setReason,
        summary: valid
            ? s.awaySummary(who, whenLabel(start, end, length !== "part"))
            : s.endBeforeStart,
        affected,
        affectedNote:
            affected.length > 0
                ? staffId === ""
                    ? s.closureAffects(affected.length)
                    : s.timeOffAffects(affected.length)
                : null,
        canSubmit: valid && reason.trim().length > 0,
        busy,
        error,
        submit: () => {
            if (!valid) {
                setError(s.endBeforeStart);
                return;
            }
            if (reason.trim().length === 0) {
                setError(s.reasonRequired);
                return;
            }
            key.current ??= newIdempotencyKey();
            const idempotencyKey = key.current;
            run(
                () =>
                    api.post(
                        "/v1/time-off",
                        {
                            staff_id: staffId === "" ? null : staffId,
                            starts_at: start.toISOString(),
                            ends_at: end.toISOString(),
                            reason: reason.trim(),
                        },
                        { idempotencyKey },
                    ),
                {
                    onSuccess: () => {
                        key.current = null;
                        onDone();
                    },
                    errorMessage: s.timeOffError,
                },
            );
        },
        timeOptions: TIME_OPTIONS,
        pickerDays: (offset) => {
            const base = addDays(startOfDay(now), offset);
            return Array.from({ length: 7 }, (_, i) => {
                const d = addDays(base, i);
                return {
                    key: dateKey(d),
                    weekday: formatWeekday(d),
                    day: String(d.getDate()),
                    closed: avail.isClosed(d) !== null,
                    isToday: sameDay(d, now),
                };
            });
        },
    };
}
