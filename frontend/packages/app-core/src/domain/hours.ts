import { discardRejectedHours, enqueueHours, strandedKey, type WeekDay } from "@clientbridge/sync";
import { useBusinessQuery as useQuery } from "../hooks";
import { usePowerSync } from "@powersync/react";
import { useEffect, useRef, useState } from "react";

import { type ApiLike, type Attempt, attemptKey } from "../api";
import {
    addDays,
    clockKey,
    clockOptions,
    combineDayAndTime,
    dateKey,
    firstWeekday,
    formatClock,
    formatClockShort,
    formatDayNumber,
    formatShortDayTime,
    formatTime,
    formatTimeRange,
    formatWeekday,
    parseTimestamp,
    sameDay,
    startOfDay,
    startOfWeek,
    wallTime,
    weekdayDay,
    useBusinessZone,
} from "../datetime";
import { formatList, formatParts, initials } from "../format";
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
import { useDevicePref, useReplicaLoad } from "./sync";

const s = strings.hours;

/** Weekday order for the editor, 0 = Monday … 6 = Sunday — matching the server's `date.weekday()`. */
const WEEKDAYS: { weekday: number; label: string; short: string }[] = [
    {
        weekday: 0,
        get label() {
            return s.monday;
        },
        get short() {
            return s.monShort;
        },
    },
    {
        weekday: 1,
        get label() {
            return s.tuesday;
        },
        get short() {
            return s.tueShort;
        },
    },
    {
        weekday: 2,
        get label() {
            return s.wednesday;
        },
        get short() {
            return s.wedShort;
        },
    },
    {
        weekday: 3,
        get label() {
            return s.thursday;
        },
        get short() {
            return s.thuShort;
        },
    },
    {
        weekday: 4,
        get label() {
            return s.friday;
        },
        get short() {
            return s.friShort;
        },
    },
    {
        weekday: 5,
        get label() {
            return s.saturday;
        },
        get short() {
            return s.satShort;
        },
    },
    {
        weekday: 6,
        get label() {
            return s.sunday;
        },
        get short() {
            return s.sunShort;
        },
    },
];

const DEFAULT_START = "09:00";
const DEFAULT_END = "17:00";
const HHMM = /^\d{2}:\d{2}$/;

interface DayHours {
    weekday: number;
    open: boolean;
    start: string;
    end: string;
    // More than one window: the week command can't carry a break, so the day is shown, not edited.
    split: boolean;
}

interface RecurringRow {
    weekday: number | null;
    start_time: string | null;
    end_time: string | null;
    available: number;
}

export const RECURRING_HOURS_SQL =
    "SELECT weekday, start_time, end_time, available FROM hours WHERE staff_id = ? AND basis = 'recurring' ORDER BY start_time";

/** Days with no rows default to weekdays 9 to 5 and weekends closed; split days show their span. */
export function seedDays(rows: RecurringRow[]): DayHours[] {
    return WEEKDAYS.map(({ weekday }) => {
        const mine = rows.filter((r) => r.weekday === weekday);
        if (mine.length === 0) {
            return {
                weekday,
                open: weekday < 5,
                start: DEFAULT_START,
                end: DEFAULT_END,
                split: false,
            };
        }
        const open = mine.filter((r) => r.available === 1);
        return {
            weekday,
            open: open.length > 0,
            start: (open[0]?.start_time ?? DEFAULT_START).slice(0, 5),
            end: (open.at(-1)?.end_time ?? DEFAULT_END).slice(0, 5),
            split: mine.length > 1,
        };
    });
}

/** Why the week can't be saved here when a day has a break between shifts, or null. */
export function splitNote(days: readonly DayHours[]): string | null {
    const split = days.filter((d) => d.split);
    if (split.length === 0) return null;
    return s.splitWeek(
        formatList(split.map((d) => WEEKDAYS[d.weekday]?.label ?? "")),
        split.length,
    );
}

/** What a refused week says, by the server's error code. */
export function refusalMessage(code: string | null): string {
    switch (code) {
        case "hours_split_week":
            return s.splitRefused;
        case "hours_revision_conflict":
            return s.conflict;
        default:
            return s.refused;
    }
}

function toWeekDays(days: DayHours[]): WeekDay[] {
    return days.map((day) => ({
        weekday: day.weekday,
        available: day.open,
        start_time: day.open ? `${day.start}:00` : null,
        end_time: day.open ? `${day.end}:00` : null,
    }));
}

function fromWeekDays(days: WeekDay[]): DayHours[] {
    return seedDays(days.map((day) => ({ ...day, available: day.available ? 1 : 0 })));
}

/** The server's current week with only the days this proposal changed from its base laid over it. */
export function rebaseWeek(base: WeekDay[], proposal: WeekDay[], current: WeekDay[]): WeekDay[] {
    const day = (week: WeekDay[], weekday: number): WeekDay =>
        week.find((d) => d.weekday === weekday) ?? {
            weekday,
            available: false,
            start_time: null,
            end_time: null,
        };
    const same = (a: WeekDay, b: WeekDay): boolean =>
        a.available === b.available &&
        (!a.available || (a.start_time === b.start_time && a.end_time === b.end_time));
    return WEEKDAYS.map(({ weekday }) => {
        const mine = day(proposal, weekday);
        return same(mine, day(base, weekday)) ? day(current, weekday) : mine;
    });
}

const toMin = (hhmm: string): number => {
    const [h = 0, m = 0] = hhmm.split(":").map(Number);
    return h * 60 + m;
};

/** "9:00 a.m. – 5:00 p.m.", or "9–5" when `short`. */
export function shiftLabel(start: string, end: string, short = false): string {
    return short
        ? strings.common.shortRange(formatClockShort(start), formatClockShort(end))
        : strings.common.range(formatClock(start), formatClock(end));
}

export const STRANDED_SQL = `
SELECT b.id, s.starts_at, s.ends_at, c.name AS client_name
FROM bookings b
JOIN slots s ON s.id = b.slot_id
LEFT JOIN clients c ON c.id = b.client_id
WHERE b.id IN (SELECT value FROM json_each(?))
  AND b.status IN ('pending', 'confirmed') AND b.deleted_at IS NULL
ORDER BY s.starts_at`;

const STAFF_HOURS_SQL =
    "SELECT basis, weekday, date, start_time, end_time, available FROM hours WHERE staff_id = ? AND basis IN ('recurring', 'date')";

interface StrandedVisit {
    id: string;
    starts_at: string;
    ends_at: string;
    client_name: string | null;
}

interface HoursRow extends RecurringRow {
    basis: string;
    date: string | null;
}

/** Whether a visit sits inside the member's hours on its local day, as the server decides it. */
export function withinHours(
    rows: readonly HoursRow[],
    start: Date,
    end: Date,
    zone: string,
): boolean {
    const day = dateKey(start, zone);
    const dated = rows.filter((r) => r.basis === "date" && r.date === day);
    const weekday = (wallTime(start, zone).weekday + 6) % 7;
    const recurring = rows.filter((r) => r.basis === "recurring" && r.weekday === weekday);
    if (dated.length === 0 && recurring.length === 0) return true;
    if (dated.some((r) => r.available === 0 && r.start_time === null)) return false;
    if (dateKey(end, zone) !== day) return false;
    const from = clockKey(start, zone);
    const to = clockKey(end, zone);
    return (dated.length > 0 ? dated : recurring).some(
        (r) =>
            r.available === 1 &&
            (r.start_time ?? "00:00").slice(0, 5) <= from &&
            to <= (r.end_time ?? "24:00").slice(0, 5),
    );
}

/** The notice listing visits a saved week left outside the hours, while they still are; or null. */
export function strandedNote(
    visits: readonly StrandedVisit[],
    hours: readonly HoursRow[],
    now: Date,
    zone: string,
): string | null {
    const left = visits.filter((v) => {
        const start = parseTimestamp(v.starts_at);
        return start >= now && !withinHours(hours, start, parseTimestamp(v.ends_at), zone);
    });
    if (left.length === 0) return null;
    return s.stranded(
        left.length,
        formatList(
            left.map((v) =>
                formatParts([formatShortDayTime(parseTimestamp(v.starts_at), zone), v.client_name]),
            ),
        ),
    );
}

function useStrandedNote(staffId: string | null): string | null {
    const businessId = useBusinessId();
    const [ids] = useDevicePref(strandedKey(businessId ?? "", staffId ?? ""));
    const visits = useQuery<StrandedVisit>(STRANDED_SQL, [ids ?? "[]"]).data;
    const hours = useQuery<HoursRow>(STAFF_HOURS_SQL, [staffId ?? ""]).data;
    const now = useNow();
    const zone = useBusinessZone();
    return strandedNote(visits, hours, now, zone);
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
    saveLabel: string;
    saveMessage: string | null;
    splitNote: string | null;
    // The visits the last accepted week left outside the hours, as one line, or null.
    stranded: string | null;
    canSave: boolean;
    discardRejected: (() => void) | null;
}

const timeOptions = (): { key: string; label: string }[] => clockOptions(30, "06:00", "22:00");

// Server weekdays count from Monday (0); the editor starts the week where the locale does.
const editorOrder = (weekday: number): number => (weekday - ((firstWeekday() + 6) % 7) + 7) % 7;

/** Key the editor by staff ID; pending proposals remain separate from authoritative hours. */
export function useWeekEditor(api: ApiLike, staffId: string | null): WeekEditor {
    const db = usePowerSync();
    const businessId = useBusinessId();
    const { data, isLoading } = useQuery<RecurringRow>(RECURRING_HOURS_SQL, [staffId ?? ""]);
    const staff = useQuery<{ hours_revision: number }>(
        "SELECT hours_revision FROM staff WHERE id = ? AND business_id = ?",
        [staffId ?? "", businessId ?? ""],
    );
    const queued = useQuery<{
        id: string;
        payload: string;
        base: string;
        state: string;
        result_revision: number | null;
    }>(
        "SELECT id, payload, base, state, result_revision FROM hours_outbox WHERE staff_id = ? AND business_id = ? ORDER BY sequence DESC LIMIT 1",
        [staffId ?? "", businessId ?? ""],
    );
    const rejection = useQuery<{ id: string; error_code: string | null }>(
        "SELECT id, error_code FROM hours_outbox WHERE staff_id = ? AND business_id = ? AND state = 'rejected' LIMIT 1",
        [staffId ?? "", businessId ?? ""],
    ).data[0];
    const rejected = rejection !== undefined;
    const stranded = useStrandedNote(staffId);
    const latest = queued.data[0];
    const revision = staff.data[0]?.hours_revision;
    const waiting =
        latest !== undefined &&
        (latest.state !== "accepted" ||
            revision === undefined ||
            revision < (latest.result_revision ?? Infinity));
    const { busy, error, setError, run } = useAsyncAction();
    const [days, setDays] = useState<DayHours[] | null>(null);
    const basis = useRef<{
        revision: number;
        id: string | null;
        payload: string;
        base: WeekDay[];
    } | null>(null);
    const rebased = useRef<string | null>(null);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        if (
            days === null &&
            !isLoading &&
            !queued.isLoading &&
            revision !== undefined &&
            staffId !== null
        ) {
            if (waiting) {
                try {
                    const proposal = JSON.parse(latest.payload) as {
                        days: WeekDay[];
                        expected_revision: number;
                    };
                    basis.current = {
                        revision: proposal.expected_revision + 1,
                        id: latest.id,
                        payload: latest.payload,
                        base: JSON.parse(latest.base) as WeekDay[],
                    };
                    setDays(fromWeekDays(proposal.days));
                } catch {
                    setError(s.saveError);
                }
            } else {
                basis.current = {
                    revision,
                    id: latest?.id ?? null,
                    payload: latest?.payload ?? "",
                    base: toWeekDays(seedDays(data)),
                };
                setDays(seedDays(data));
            }
        }
    }, [days, isLoading, queued.isLoading, data, staffId, waiting, latest, revision, setError]);

    // A conflict shows the server's current week with only this person's own changes laid over it.
    useEffect(() => {
        if (
            rejection?.error_code !== "hours_revision_conflict" ||
            rebased.current === rejection.id ||
            latest?.id !== rejection.id ||
            revision === undefined ||
            basis.current === null
        )
            return;
        const proposal = JSON.parse(latest.payload) as {
            days: WeekDay[];
            expected_revision: number;
        };
        if (revision <= proposal.expected_revision) return;
        const current = toWeekDays(seedDays(data));
        rebased.current = rejection.id;
        basis.current = { ...basis.current, base: current };
        setDays(
            fromWeekDays(rebaseWeek(JSON.parse(latest.base) as WeekDay[], proposal.days, current)),
        );
    }, [rejection, latest, revision, data]);

    const edit = (weekday: number, patch: Partial<DayHours>): void => {
        setSaved(false);
        setDays((d) => d?.map((x) => (x.weekday === weekday ? { ...x, ...patch } : x)) ?? d);
    };
    const note = splitNote(days ?? []);
    // A split week is refused whatever this device sends, so only discarding moves it on.
    const blocked = note !== null || rejection?.error_code === "hours_split_week";
    const view = (days ?? [])
        .map((d) => ({
            ...d,
            label: WEEKDAYS[d.weekday]?.label ?? "",
            short: WEEKDAYS[d.weekday]?.short ?? "",
            hours: d.open ? Math.max(0, (toMin(d.end) - toMin(d.start)) / 60) : 0,
            error: d.open && d.start >= d.end ? s.timeOrderShort : null,
        }))
        .sort((a, b) => editorOrder(a.weekday) - editorOrder(b.weekday));

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
        error: error ?? (rejected ? refusalMessage(rejection.error_code) : null),
        saved,
        saveLabel: rejected ? s.applyChanges : s.saveHours,
        saveMessage: rejected ? null : waiting ? s.savedLocally : saved ? s.saved : null,
        splitNote: note,
        stranded,
        canSave: days !== null && !blocked,
        discardRejected: rejected
            ? () => {
                  run(
                      async () => {
                          if (businessId === null || staffId === null) return;
                          await discardRejectedHours(db, businessId, staffId);
                          basis.current =
                              revision === undefined
                                  ? null
                                  : {
                                        revision,
                                        id: null,
                                        payload: "",
                                        base: toWeekDays(seedDays(data)),
                                    };
                          setDays(seedDays(data));
                          setSaved(false);
                      },
                      { errorMessage: s.saveError },
                  );
              }
            : null,
        submit: () => {
            if (days === null || staffId === null || blocked) return;
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
                    if (basis.current === null) throw new Error("working week has not synced");
                    const base = rejected
                        ? (await api.get<{ revision: number }>(`/v1/hours/${staffId}/week`))
                              .revision
                        : basis.current.revision;
                    const from = basis.current.base;
                    const queued = await enqueueHours(
                        db,
                        staffId,
                        businessId,
                        base,
                        toWeekDays(days),
                        from,
                        rejected,
                        basis.current.id === null
                            ? null
                            : { id: basis.current.id, payload: basis.current.payload },
                    );
                    basis.current = { ...queued, base: from };
                },
                {
                    onSuccess: () => {
                        setSaved(true);
                    },
                    errorMessage: s.saveError,
                },
            );
        },
        timeOptions: timeOptions(),
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
        dayNumber: string;
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

function whenLabel(start: Date, end: Date, allDay: boolean, zone: string): string {
    if (allDay) {
        const last = addDays(end, -1, zone);
        return sameDay(start, last, zone)
            ? weekdayDay(start, zone)
            : strings.common.range(weekdayDay(start, zone), weekdayDay(last, zone));
    }
    return strings.common.dayAndTime(weekdayDay(start, zone), formatTimeRange(start, end, zone));
}

const isAllDay = (start: Date, end: Date, zone: string): boolean =>
    clockKey(start, zone) === "00:00" && clockKey(end, zone) === "00:00";

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
    zone: string,
): AwayEntry {
    const allDay = isAllDay(b.start, b.end, zone);
    return {
        id: b.id,
        staffId: b.staffId,
        who: b.staffId === null ? s.everyone : (names.get(b.staffId) ?? ""),
        reason: b.label,
        start: b.start,
        end: b.end,
        allDay,
        when: whenLabel(b.start, b.end, allDay, zone),
        affected: affectedBy(events, b.staffId, b.start, b.end).length,
        past: b.end <= now,
    };
}

const AHEAD_DAYS = 120;

/** The team's week: each person's shift per day, with time off and closures laid over it. */
export function useTeamWeek(api: ApiLike, viewer: Viewer | null): TeamWeek {
    const now = useNow();
    const zone = useBusinessZone();
    const today = startOfDay(now, zone);
    const [anchor, setAnchor] = useState(() => startOfWeek(today, zone));
    const horizon = addDays(today, AHEAD_DAYS, zone);
    const weekEnd = addDays(anchor, 7, zone);
    const until = horizon > weekEnd ? horizon : weekEnd;
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
    const away = avail.awayRows.map((b) => toAway(b, names, events, now, zone));
    const cols = Array.from({ length: 7 }, (_, i) => addDays(anchor, i, zone));
    const days = cols.map((date) => ({
        key: dateKey(date, zone),
        date,
        weekday: formatWeekday(date, zone),
        dayNumber: formatDayNumber(date, zone),
        isToday: sameDay(date, now, zone),
        closure: away.find((a) => a.staffId === null && a.start <= date && a.end > date) ?? null,
    }));
    const rowsFor = (id: string): RecurringRow[] => hours.data.filter((h) => h.staff_id === id);
    const load = useReplicaLoad([hours, eventsLoad, ...avail.sources], hours.data.length === 0);

    return {
        load,
        days,
        label: strings.common.range(
            weekdayDay(cols[0] ?? anchor, zone),
            weekdayDay(cols[6] ?? anchor, zone),
        ),
        shift: (dir) => {
            setAnchor((a) => addDays(a, dir * 7, zone));
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
                    const dayEnd = addDays(d.date, 1, zone);
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
                    return {
                        kind: "shift",
                        label: shiftLabel(
                            clockKey(first.start, zone),
                            clockKey(last.end, zone),
                            true,
                        ),
                        partial: part
                            ? s.partialAway(formatTime(part.start, zone), part.reason)
                            : null,
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
    pickerDays: { key: string; weekday: string; day: string; closed: boolean; isToday: boolean }[];
    // Weeks from this one; only the shown week's closures are read.
    pickerWeek: number;
    setPickerWeek: (week: number) => void;
}

/** Time off for one person, or a closure for everyone; lists the visits it would leave without a groomer. */
export function useTimeOffForm(
    api: ApiLike,
    viewer: Viewer | null,
    onDone: () => void,
    initialStaffId: string,
): TimeOffForm {
    const now = useNow();
    const zone = useBusinessZone();
    const staffRows = useStaff();
    const manager = viewer !== null && canManageStaff(viewer.role);
    const [staffId, setStaffId] = useState(initialStaffId);
    const [length, setLength] = useState<AwayLength>("day");
    const [from, setFrom] = useState(dateKey(addDays(now, 1, zone), zone));
    const [to, setTo] = useState(dateKey(addDays(now, 1, zone), zone));
    const [startTime, setStartTime] = useState("10:00");
    const [endTime, setEndTime] = useState("12:00");
    const [reason, setReason] = useState("");
    const { busy, error, setError, run } = useAsyncAction();
    const key = useRef<Attempt | null>(null);

    const start = combineDayAndTime(from, length === "part" ? startTime : "00:00", zone);
    const lastDay =
        length === "day" || length === "part"
            ? from
            : length === "week"
              ? dateKey(addDays(start, 6, zone), zone)
              : to;
    const end =
        length === "part"
            ? combineDayAndTime(from, endTime, zone)
            : addDays(combineDayAndTime(lastDay, "00:00", zone), 1, zone);
    const valid = end > start;
    const today = startOfDay(now, zone);
    const { events } = useScheduleEvents(start > today ? start : today, end);
    const [pickerWeek, setPickerWeek] = useState(0);
    const pickerStart = addDays(today, pickerWeek * 7, zone);
    const avail = useAvailability(pickerStart, addDays(pickerStart, 7, zone));
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
            if (to < k) setTo(k);
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
            ? s.awaySummary(who, whenLabel(start, end, length !== "part", zone))
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
            const body = {
                staff_id: staffId === "" ? null : staffId,
                starts_at: start.toISOString(),
                ends_at: end.toISOString(),
                reason: reason.trim(),
            };
            const idempotencyKey = attemptKey(key, body);
            run(() => api.post("/v1/time-off", body, { idempotencyKey }), {
                onSuccess: () => {
                    key.current = null;
                    onDone();
                },
                errorMessage: s.timeOffError,
            });
        },
        timeOptions: timeOptions(),
        pickerDays: Array.from({ length: 7 }, (_, i) => {
            const d = addDays(pickerStart, i, zone);
            return {
                key: dateKey(d, zone),
                weekday: formatWeekday(d, zone),
                day: formatDayNumber(d, zone),
                closed: avail.isClosed(d) !== null,
                isToday: sameDay(d, now, zone),
            };
        }),
        pickerWeek,
        setPickerWeek,
    };
}
