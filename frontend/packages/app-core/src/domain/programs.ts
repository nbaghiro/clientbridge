import { useRef, useState } from "react";

import { type ApiLike, type Attempt, attemptKey, failureMessage } from "../api";
import {
    addDays,
    clockOptions,
    combineDayAndTime,
    dateKey,
    formatTimeRange,
    formatWeekdayName,
    parseTimestamp,
    sameDay,
    startOfDay,
    useBusinessZone,
    wallTime,
    weekOrder,
    weekdayDay,
} from "../datetime";
import { formatList, formatMoney, formatParts } from "../format";
import { type Load, useAsyncAction, useBusinessQuery as useQuery, useNow } from "../hooks";
import { strings } from "../strings";
import type { ChoiceOption, Intent, SelectOption } from "../ui";
import type { Viewer } from "./auth";
import { actorsFor } from "./bookings";
import { idList, useCatalogItems } from "./catalog";
import {
    CLASS_CLIENTS_SQL,
    type RosterEntry,
    type RosterRow,
    type SeatCandidate,
    type SeatMatch,
    rosterEntry,
    seatKey,
    seatMatches,
    sessionCounts,
} from "./classes";
import { activePool, resourceName, useResources } from "./resources";
import { staffName, useStaff } from "./staff";
import { parseAttributes, pickupLine, useSubjectKind } from "./subjects";
import { useReplicaLoad } from "./sync";

const s = strings.programs;

type ProgramWeekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";
// by the JavaScript weekday, 0 being Sunday
const CODES: readonly ProgramWeekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const WORK_WEEK: readonly ProgramWeekday[] = ["MO", "TU", "WE", "TH", "FR"];

interface ProgramRow {
    id: string;
    staff_id: string | null;
    item_name: string;
    item_color: string | null;
    session_count: number;
    price_cents: number | null;
    currency: string;
}

interface DayRow {
    slot_id: string;
    recurrence_id: string;
    starts_at: string;
    ends_at: string;
    capacity: number;
    resource_id: string | null;
}

interface SeatRow extends RosterRow {
    recurrence_id: string;
    price_cents: number;
    starts_at: string;
}

export const PROGRAMS_SQL = `
SELECT r.id, r.staff_id, i.name AS item_name, i.color AS item_color, i.session_count,
       i.price_cents, i.currency
FROM recurrences r JOIN items i ON i.id = r.item_id
WHERE r.client_id IS NULL AND r.status = 'active' AND i.session_count IS NOT NULL`;

export const PROGRAM_DAYS_SQL = `
SELECT s.id AS slot_id, s.recurrence_id, s.starts_at, s.ends_at, s.capacity, s.resource_id
FROM slots s JOIN recurrences r ON r.id = s.recurrence_id
WHERE r.client_id IS NULL AND r.status = 'active' AND s.status != 'canceled'`;

export const PROGRAM_SEATS_SQL = `
SELECT b.id AS booking_id, b.slot_id, s.recurrence_id, s.starts_at, b.client_id, b.subject_id,
       c.name AS client_name, c.phone AS client_phone,
       sj.name AS subject_name, sj.attributes AS subject_attributes, b.status, b.checked_in_at,
       b.deposit_status, b.price_cents
FROM bookings b JOIN slots s ON s.id = b.slot_id JOIN recurrences r ON r.id = s.recurrence_id
JOIN clients c ON c.id = b.client_id LEFT JOIN subjects sj ON sj.id = b.subject_id
WHERE r.client_id IS NULL AND r.status = 'active' AND b.status != 'canceled'
  AND b.deleted_at IS NULL
ORDER BY b.created_at, b.id`;

interface ProgramSummary {
    id: string;
    name: string;
    color: string | null;
    dates: string;
    time: string;
    staffName: string;
    days: number;
    enrolled: number;
    seatsLeft: number;
    seatsLabel: string;
    price: string;
    intent: Intent;
    start: Date;
}

interface ProgramDay {
    slotId: string;
    label: string;
    time: string;
    booked: number;
    capacity: number;
    checkedIn: number;
    full: boolean;
    seatsLabel: string;
    started: boolean;
    today: boolean;
    // the room or equipment the session holds
    room: string | null;
}

export interface Enrolment {
    key: string;
    clientId: string;
    subjectId: string | null;
    name: string;
    clientName: string;
    pickup: string | null;
    attending: string;
    away: string | null;
    paid: boolean;
    upcoming: boolean;
}

export interface ProgramBoard {
    programs: ProgramSummary[];
    load: Load;
    selected: string | null;
    select: (id: string) => void;
    program: ProgramSummary | null;
    days: ProgramDay[];
    day: ProgramDay | null;
    selectDay: (slotId: string) => void;
    attendees: RosterEntry[];
    checkIn: (key: string) => void;
    undo: (key: string) => void;
    noShow: (key: string) => void;
    checkInAll: () => void;
    enrolments: Enrolment[];
    query: string;
    setQuery: (q: string) => void;
    matches: SeatMatch[];
    enrol: (key: string) => void;
    cancelEnrolment: (key: string) => void;
    canCancelProgram: boolean;
    cancelProgram: () => void;
    notice: string | null;
    busy: boolean;
    error: string | null;
}

const byStart = <T extends { starts_at: string }>(a: T, b: T): number =>
    parseTimestamp(a.starts_at).getTime() - parseTimestamp(b.starts_at).getTime();

/** Programs still running or ahead, each day's roster and check-in, and who is enrolled. */
export function useProgramBoard(api: ApiLike): ProgramBoard {
    const now = useNow();
    const zone = useBusinessZone();
    const kind = useSubjectKind();
    const staff = useStaff();
    const programsQ = useQuery<ProgramRow>(PROGRAMS_SQL);
    const daysQ = useQuery<DayRow>(PROGRAM_DAYS_SQL);
    const rooms = useResources();
    const seatsQ = useQuery<SeatRow>(PROGRAM_SEATS_SQL);
    const clients = useQuery<SeatCandidate>(CLASS_CLIENTS_SQL).data;
    const [selected, setSelected] = useState<string | null>(null);
    const [picked, setPicked] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [notice, setNotice] = useState<string | null>(null);
    const { busy, error, run } = useAsyncAction();
    const attempt = useRef<Attempt | null>(null);
    const today = startOfDay(now, zone);
    const allDays = [...daysQ.data].sort(byStart);
    const seats = seatsQ.data;

    const programs: ProgramSummary[] = programsQ.data
        .map((r): ProgramSummary | null => {
            const days = allDays.filter((d) => d.recurrence_id === r.id);
            const first = days[0];
            const last = days.at(-1);
            if (first === undefined || last === undefined) return null;
            const start = parseTimestamp(first.starts_at);
            const end = parseTimestamp(last.ends_at);
            if (end < today) return null;
            const mine = seats.filter((x) => x.recurrence_id === r.id);
            const ahead = days.filter((d) => parseTimestamp(d.starts_at) > now);
            const left = Math.min(
                ...(ahead.length > 0 ? ahead : days).map(
                    (d) =>
                        d.capacity -
                        mine.filter((x) => x.slot_id === d.slot_id && x.status !== "waitlisted")
                            .length,
                ),
            );
            const enrolled = new Set(
                mine.map((x) => seatKey(x.client_id, kind === null ? null : x.subject_id)),
            ).size;
            const member = staff.find((x) => x.id === r.staff_id);
            return {
                id: r.id,
                name: r.item_name,
                color: r.item_color,
                dates: s.dates(weekdayDay(start, zone), weekdayDay(end, zone)),
                time: formatTimeRange(start, parseTimestamp(first.ends_at), zone),
                staffName: member ? staffName(member) : "",
                days: days.length,
                enrolled,
                seatsLeft: Math.max(0, left),
                seatsLabel: left <= 0 ? s.full : s.seatsLeft(left),
                price: formatMoney(r.price_cents ?? 0, r.currency),
                intent: left <= 0 ? "warning" : enrolled === 0 ? "neutral" : "accent",
                start,
            };
        })
        .filter((x): x is ProgramSummary => x !== null)
        .sort((a, b) => a.start.getTime() - b.start.getTime());

    const current = programs.find((x) => x.id === selected) ?? programs[0] ?? null;
    const dayRows = current ? allDays.filter((d) => d.recurrence_id === current.id) : [];
    const mine = current ? seats.filter((x) => x.recurrence_id === current.id) : [];
    const days: ProgramDay[] = dayRows.map((d) => {
        const start = parseTimestamp(d.starts_at);
        const { booked, checkedIn } = sessionCounts(mine.filter((x) => x.slot_id === d.slot_id));
        const full = booked >= d.capacity;
        return {
            slotId: d.slot_id,
            label: weekdayDay(start, zone),
            time: formatTimeRange(start, parseTimestamp(d.ends_at), zone),
            booked,
            capacity: d.capacity,
            checkedIn,
            full,
            seatsLabel: full ? s.full : s.seatsLeft(d.capacity - booked),
            started: sameDay(start, now, zone) || start <= now,
            today: sameDay(start, now, zone),
            room: resourceName(rooms, d.resource_id),
        };
    });
    const day =
        days.find((d) => d.slotId === picked) ??
        days.find((d) => d.today) ??
        days.find((d) => !d.started) ??
        days.at(-1) ??
        null;
    const onDay = day ? mine.filter((x) => x.slot_id === day.slotId) : [];

    const groups = new Map<string, SeatRow[]>();
    for (const row of mine) {
        const k = seatKey(row.client_id, kind === null ? null : row.subject_id);
        groups.set(k, [...(groups.get(k) ?? []), row]);
    }
    const enrolments: Enrolment[] = [...groups.entries()].map(([k, rows]) => {
        const first = rows[0];
        const attrs = parseAttributes(first?.subject_attributes ?? null);
        const held = new Set(rows.map((x) => x.slot_id));
        const away = days.filter((d) => !held.has(d.slotId)).map((d) => d.label);
        const priced = rows.find((x) => x.price_cents > 0) ?? first;
        return {
            key: k,
            clientId: first?.client_id ?? "",
            subjectId: first?.subject_id ?? null,
            name: first?.subject_name ?? first?.client_name ?? "",
            clientName: first?.client_name ?? "",
            pickup: pickupLine(kind, attrs),
            attending: s.attending(held.size, days.length),
            away: away.length === 0 ? null : s.away(formatList(away)),
            paid: priced?.deposit_status !== "pending",
            upcoming: rows.some((x) => parseTimestamp(x.starts_at) > now),
        };
    });
    const enrolled = new Set(groups.keys());

    const act = (key: string, action: "check_in" | "undo" | "no_show"): void => {
        if (day === null) return;
        run(() => api.patch(`/v1/classes/${day.slotId}/roster/${key}`, { action }), {
            errorMessage: (e) => failureMessage(e, s.rosterError),
        });
    };
    const enrolment = (key: string): Enrolment | undefined => enrolments.find((x) => x.key === key);

    return {
        programs,
        load: useReplicaLoad([programsQ, daysQ, seatsQ], programs.length === 0),
        selected: current?.id ?? null,
        select: (id) => {
            setSelected(id);
            setPicked(null);
            setQuery("");
            setNotice(null);
        },
        program: current,
        days,
        day,
        selectDay: setPicked,
        attendees: onDay.map((r) => rosterEntry(kind, zone, r)),
        checkIn: (key) => {
            act(key, "check_in");
        },
        undo: (key) => {
            act(key, "undo");
        },
        noShow: (key) => {
            act(key, "no_show");
        },
        checkInAll: () => {
            if (day === null) return;
            const waiting = onDay.filter(
                (r) => r.status === "confirmed" && r.checked_in_at === null,
            );
            run(
                () =>
                    Promise.all(
                        waiting.map((r) =>
                            api.patch(`/v1/classes/${day.slotId}/roster/${r.booking_id}`, {
                                action: "check_in",
                            }),
                        ),
                    ),
                { errorMessage: s.rosterError },
            );
        },
        enrolments,
        query,
        setQuery,
        matches: current ? seatMatches(clients, query, enrolled, kind !== null) : [],
        enrol: (key) => {
            if (current === null) return;
            const m = seatMatches(clients, query, enrolled, kind !== null).find(
                (x) => x.key === key,
            );
            if (m === undefined) return;
            const body = { client_id: m.clientId, subject_id: m.subjectId };
            const idempotencyKey = attemptKey(attempt, { program: current.id, ...body });
            setQuery("");
            setNotice(null);
            run(
                async () => {
                    await api.post(`/v1/programs/${current.id}/enrolments`, body, {
                        idempotencyKey,
                    });
                    attempt.current = null;
                    setNotice(s.enrolled(m.subjectName === "" ? m.name : m.subjectName));
                },
                { errorMessage: (e) => failureMessage(e, s.enrolError) },
            );
        },
        cancelEnrolment: (key) => {
            const e = enrolment(key);
            if (current === null || e === undefined) return;
            setNotice(null);
            run(
                async () => {
                    await api.post(`/v1/programs/${current.id}/enrolments/cancel`, {
                        client_id: e.clientId,
                        subject_id: e.subjectId,
                    });
                    setNotice(s.canceledEnrolment(e.name));
                },
                { errorMessage: (err) => failureMessage(err, s.cancelError) },
            );
        },
        canCancelProgram: current !== null && !mine.some((x) => parseTimestamp(x.starts_at) > now),
        cancelProgram: () => {
            if (current === null) return;
            run(
                async () => {
                    await api.post(`/v1/programs/${current.id}/cancel`, {});
                    setSelected(null);
                    setNotice(s.canceledProgram(current.name));
                },
                { errorMessage: (err) => failureMessage(err, s.cancelError) },
            );
        },
        notice,
        busy,
        error,
    };
}

/** The dates a weekly schedule lands on: from the first day, on the chosen weekdays, `count` of them. */
export function scheduleDays(
    firstDay: string,
    weekdays: readonly ProgramWeekday[],
    count: number,
    zone: string,
): Date[] {
    const out: Date[] = [];
    if (weekdays.length === 0 || count <= 0) return out;
    const start = combineDayAndTime(firstDay, "00:00", zone);
    for (let i = 0; out.length < count && i < 7 * 60; i++) {
        const d = addDays(start, i, zone);
        if (weekdays.includes(CODES[wallTime(d, zone).weekday] ?? "SU")) out.push(d);
    }
    return out;
}

export interface ProgramForm {
    itemId: string;
    setItemId: (id: string) => void;
    itemOptions: SelectOption<string>[];
    staffId: string;
    setStaffId: (id: string) => void;
    staffOptions: SelectOption<string>[];
    firstDay: string;
    setFirstDay: (key: string) => void;
    time: string;
    setTime: (hhmm: string) => void;
    timeOptions: { key: string; label: string }[];
    weekdays: ProgramWeekday[];
    toggleWeekday: (day: ProgramWeekday) => void;
    weekdayOptions: ChoiceOption<ProgramWeekday>[];
    preview: string;
    summary: string | null;
    // which rooms the days take, from the class's pool; null when it needs none
    rooms: string | null;
    canSubmit: boolean;
    // why the program can't be scheduled yet, once a program is chosen
    blocker: string | null;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** A program's sessions laid out ahead: which class, who teaches it, the first day and weekdays. */
export function useProgramForm(
    api: ApiLike,
    viewer: Viewer | null,
    onDone: (name: string) => void,
): ProgramForm {
    const zone = useBusinessZone();
    const programs = useCatalogItems().filter(
        (i) => i.kind === "class" && i.active === 1 && i.session_count !== null,
    );
    const team = actorsFor(
        useStaff().filter((x) => x.status === "active"),
        viewer,
    );
    const today = startOfDay(new Date(), zone);
    const nextMonday = addDays(today, (8 - wallTime(today, zone).weekday) % 7 || 7, zone);
    const [itemId, setItemId] = useState("");
    const [chosenStaff, setStaffId] = useState(viewer?.staffId ?? "");
    const [firstDay, setFirstDay] = useState(dateKey(nextMonday, zone));
    const [time, setTime] = useState("09:00");
    const [weekdays, setWeekdays] = useState<ProgramWeekday[]>([...WORK_WEEK]);
    const { busy, error, setError, run } = useAsyncAction();
    const attempt = useRef<Attempt | null>(null);
    const item = programs.find((i) => i.id === itemId) ?? null;
    const rooms = useResources();
    const pool = activePool(rooms, idList(item?.resource_ids ?? null));
    const offered = item === null ? [] : idList(item.staff_ids);
    const staff = team.filter((x) => offered.length === 0 || offered.includes(x.id));
    const count = item?.session_count ?? 0;
    const staffId = staff.some((x) => x.id === chosenStaff) ? chosenStaff : (staff[0]?.id ?? "");
    const dates = item === null ? [] : scheduleDays(firstDay, weekdays, count, zone);
    const blocker =
        item === null
            ? s.pickProgram
            : staffId === ""
              ? s.pickInstructor
              : dates.length !== count
                ? s.pickDays(count)
                : null;
    const ready = blocker === null;
    const order = weekOrder().map((n) => CODES[n] ?? "SU");
    const first = dates[0];
    const last = dates.at(-1);
    return {
        itemId,
        setItemId: (id) => {
            setItemId(id);
            setError(null);
        },
        itemOptions: programs.map((i) => ({
            key: i.id,
            label: i.name,
            detail: s.daysCount(i.session_count ?? 0),
        })),
        staffId,
        setStaffId,
        staffOptions: staff.map((x) => ({ key: x.id, label: staffName(x) })),
        firstDay,
        setFirstDay,
        time,
        setTime,
        timeOptions: clockOptions(30, "06:00", "21:00"),
        weekdays,
        toggleWeekday: (day) => {
            setWeekdays((prev) =>
                prev.includes(day) ? prev.filter((x) => x !== day) : [...prev, day],
            );
        },
        weekdayOptions: order.map((code) => ({
            key: code,
            label: formatWeekdayName(CODES.indexOf(code), "short"),
        })),
        preview: formatParts(dates.map((d) => weekdayDay(d, zone))),
        summary:
            first && last && item
                ? s.summary(dates.length, weekdayDay(first, zone), weekdayDay(last, zone))
                : null,
        rooms:
            pool.length === 0
                ? null
                : s.rooms(pool.length, formatList(pool.map((id) => resourceName(rooms, id) ?? id))),
        canSubmit: ready,
        blocker: item === null ? null : blocker,
        busy,
        error,
        submit: () => {
            if (blocker !== null || item === null) {
                setError(blocker);
                return;
            }
            const body = {
                item_id: itemId,
                staff_id: staffId,
                starts_at: combineDayAndTime(firstDay, time, zone).toISOString(),
                byday: order.filter((code) => weekdays.includes(code)),
                count,
            };
            const idempotencyKey = attemptKey(attempt, body);
            run(
                async () => {
                    await api.post("/v1/programs", body, { idempotencyKey });
                    onDone(item.name);
                },
                { errorMessage: (e) => failureMessage(e, s.createError) },
            );
        },
    };
}
