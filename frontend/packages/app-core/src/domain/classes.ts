import { useBusinessQuery as useQuery } from "../hooks";

import { useState } from "react";

import type { ApiLike } from "../api";
import { addDays, formatTime, parseTimestamp, relativeDay, sameDay, startOfDay } from "../datetime";
import { type Load, useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { Intent } from "../ui";
import { type ScheduleEvent, useNow } from "./bookings";
import { utcSql } from "../datetime";
import { staffName, useStaff } from "./staff";
import { useReplicaLoad } from "./sync";

const s = strings.classes;

interface SessionRow {
    slot_id: string;
    starts_at: string;
    ends_at: string;
    capacity: number;
    staff_id: string;
    item_name: string;
    item_color: string | null;
    room: string | null;
}

interface RosterRow {
    booking_id: string;
    slot_id: string;
    client_id: string;
    client_name: string;
    client_phone: string | null;
    client_email: string | null;
    pet_name: string | null;
    pet_attributes: string | null;
    status: string;
    checked_in_at: string | null;
    deposit_status: string;
}

export const CLASS_SESSIONS_SQL = `
SELECT s.id AS slot_id, s.starts_at, s.ends_at, s.capacity, s.staff_id,
       i.name AS item_name, i.color AS item_color, r.name AS room
FROM slots s JOIN items i ON i.id = s.item_id LEFT JOIN resources r ON r.id = s.resource_id
WHERE s.capacity > 1 AND s.status != 'canceled'
  AND ${utcSql("s.ends_at")} > datetime(?) AND ${utcSql("s.starts_at")} < datetime(?)
ORDER BY s.starts_at`;

export const CLASS_ROSTER_SQL = `
SELECT b.id AS booking_id, b.slot_id, b.client_id, c.name AS client_name, c.phone AS client_phone,
       c.email AS client_email, sj.name AS pet_name, sj.attributes AS pet_attributes, b.status,
       b.checked_in_at, b.deposit_status
FROM bookings b JOIN slots s ON s.id = b.slot_id JOIN clients c ON c.id = b.client_id
LEFT JOIN subjects sj ON sj.id = b.subject_id
WHERE s.capacity > 1 AND b.status != 'canceled' AND b.deleted_at IS NULL
  AND ${utcSql("s.ends_at")} > datetime(?)
ORDER BY b.created_at`;

export const CLASS_CLIENTS_SQL = `
SELECT c.id, c.name, (SELECT sj.id FROM subjects sj WHERE sj.client_id = c.id ORDER BY sj.name LIMIT 1) AS pet_id,
       (SELECT sj.name FROM subjects sj WHERE sj.client_id = c.id ORDER BY sj.name LIMIT 1) AS pet_name
FROM clients c WHERE c.status = 'active' ORDER BY c.name COLLATE NOCASE`;

interface ClassSession {
    slotId: string;
    name: string;
    color: string | null;
    start: Date;
    end: Date;
    when: string;
    day: string;
    time: string;
    staffName: string;
    roomName: string;
    capacity: number;
    booked: number;
    waitlist: number;
    checkedIn: number;
    full: boolean;
    seatsLabel: string;
    intent: Intent;
}

type RosterStatus = "confirmed" | "checked_in" | "no_show" | "waitlist";

export interface RosterEntry {
    key: string;
    clientId: string;
    clientName: string;
    petName: string;
    petDetail: string;
    status: RosterStatus;
    statusLabel: string;
    intent: Intent;
    paid: boolean;
    note: string | null;
}

export interface ClassRoster {
    session: ClassSession;
    attendees: RosterEntry[];
    waitlist: RosterEntry[];
    checkIn: (key: string) => void;
    undo: (key: string) => void;
    noShow: (key: string) => void;
    promote: (key: string) => void;
    checkInAll: () => void;
    query: string;
    setQuery: (q: string) => void;
    matches: { clientId: string; name: string; pet: string; petId: string | null }[];
    add: (clientId: string) => void;
    notice: string | null;
    started: boolean;
    busy: boolean;
    error: string | null;
}

const STATUS: Record<RosterStatus, { label: string; intent: Intent }> = {
    confirmed: { label: s.statusBooked, intent: "accent" },
    checked_in: { label: s.statusHere, intent: "success" },
    no_show: { label: s.statusNoShow, intent: "danger" },
    waitlist: { label: s.statusWaiting, intent: "neutral" },
};

export function rosterStatus(r: RosterRow): RosterStatus {
    if (r.status === "waitlisted") return "waitlist";
    if (r.status === "no_show") return "no_show";
    return r.checked_in_at !== null ? "checked_in" : "confirmed";
}

function attributes(raw: string | null): { breed: string | null; temperament: string | null } {
    try {
        const parsed: unknown = raw === null ? {} : JSON.parse(raw);
        const o = (parsed ?? {}) as Record<string, unknown>;
        return {
            breed: typeof o.breed === "string" ? o.breed : null,
            temperament: typeof o.temperament === "string" ? o.temperament : null,
        };
    } catch {
        return { breed: null, temperament: null };
    }
}

interface ClassBoard {
    sessions: ClassSession[];
    selected: string | null;
    select: (slotId: string) => void;
    roster: ClassRoster | null;
    load: Load;
    messageClass: (body: string, onSent: (sent: number) => void) => void;
    messaging: boolean;
    messageError: string | null;
}

/** Class sessions coming up with their seats, and the selected session's roster and waitlist. */
export function useClassBoard(api: ApiLike): ClassBoard {
    const now = useNow();
    const from = startOfDay(now);
    const sessionsQ = useQuery<SessionRow>(CLASS_SESSIONS_SQL, [
        from.toISOString(),
        addDays(from, 21).toISOString(),
    ]);
    const rosterQ = useQuery<RosterRow>(CLASS_ROSTER_SQL, [from.toISOString()]);
    const clients = useQuery<{
        id: string;
        name: string;
        pet_id: string | null;
        pet_name: string | null;
    }>(CLASS_CLIENTS_SQL).data;
    const staff = useStaff();
    const [selected, setSelected] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [notice, setNotice] = useState<string | null>(null);
    const { busy, error, run } = useAsyncAction();
    const sender = useAsyncAction();
    const roster = rosterQ.data;

    const sessions: ClassSession[] = sessionsQ.data.map((r) => {
        const mine = roster.filter((b) => b.slot_id === r.slot_id);
        const booked = mine.filter((b) => b.status !== "waitlisted").length;
        const waitlist = mine.filter((b) => b.status === "waitlisted").length;
        const full = booked >= r.capacity;
        const start = parseTimestamp(r.starts_at);
        const end = parseTimestamp(r.ends_at);
        const member = staff.find((x) => x.id === r.staff_id);
        return {
            slotId: r.slot_id,
            name: r.item_name,
            color: r.item_color,
            start,
            end,
            when: `${relativeDay(start)} · ${formatTime(start)} – ${formatTime(end)}`,
            day: relativeDay(start),
            time: `${formatTime(start)} – ${formatTime(end)}`,
            staffName: member ? staffName(member) : "",
            roomName: r.room ?? "",
            capacity: r.capacity,
            booked,
            waitlist,
            checkedIn: mine.filter((b) => b.status === "confirmed" && b.checked_in_at !== null)
                .length,
            full,
            seatsLabel: full
                ? waitlist > 0
                    ? s.fullWaiting(waitlist)
                    : s.full
                : s.seatsLeft(r.capacity - booked),
            intent: full ? "warning" : booked === 0 ? "neutral" : "accent",
        };
    });
    const current = selected ?? sessions[0]?.slotId ?? null;
    const session = sessions.find((x) => x.slotId === current) ?? null;
    const mine = roster.filter((b) => b.slot_id === current);
    const entry = (r: RosterRow): RosterEntry => {
        const attrs = attributes(r.pet_attributes);
        const status = rosterStatus(r);
        return {
            key: r.booking_id,
            clientId: r.client_id,
            clientName: r.client_name,
            petName: r.pet_name ?? r.client_name,
            petDetail: [attrs.breed, attrs.temperament].filter(Boolean).join(" · "),
            status,
            statusLabel: STATUS[status].label,
            intent: STATUS[status].intent,
            paid: r.deposit_status !== "pending",
            note:
                attrs.temperament === "anxious" || attrs.temperament === "skittish"
                    ? s.gentleNote
                    : null,
        };
    };
    const act = (
        key: string,
        action: "check_in" | "undo" | "no_show" | "promote",
        onDone?: () => void,
    ): void => {
        if (current === null) return;
        run(() => api.patch(`/v1/classes/${current}/roster/${key}`, { action }), {
            ...(onDone ? { onSuccess: onDone } : {}),
            errorMessage: s.rosterError,
        });
    };
    const inClass = new Set(mine.map((r) => r.client_id));
    const t = query.trim().toLowerCase();
    const load = useReplicaLoad([sessionsQ, rosterQ], sessions.length === 0);

    return {
        sessions,
        selected: current,
        select: (id) => {
            setSelected(id);
            setNotice(null);
            setQuery("");
        },
        load,
        messageClass: (body, onSent) => {
            if (body.trim() === "" || current === null) return;
            sender.run(
                async () => {
                    const out = await api.post<{ sent: number }>(`/v1/classes/${current}/message`, {
                        body: body.trim(),
                    });
                    onSent(out.sent);
                },
                { errorMessage: s.rosterError },
            );
        },
        messaging: sender.busy,
        messageError: sender.error,
        roster: session
            ? {
                  session,
                  attendees: mine.filter((r) => r.status !== "waitlisted").map(entry),
                  waitlist: mine.filter((r) => r.status === "waitlisted").map(entry),
                  checkIn: (key) => {
                      act(key, "check_in");
                  },
                  undo: (key) => {
                      act(key, "undo");
                  },
                  noShow: (key) => {
                      act(key, "no_show");
                  },
                  promote: (key) => {
                      if (session.full) {
                          setNotice(s.promoteFull);
                          return;
                      }
                      act(key, "promote", () => {
                          setNotice(s.promoted);
                      });
                  },
                  checkInAll: () => {
                      if (current === null) return;
                      const waiting = mine.filter(
                          (r) => r.status === "confirmed" && r.checked_in_at === null,
                      );
                      run(
                          () =>
                              Promise.all(
                                  waiting.map((r) =>
                                      api.patch(`/v1/classes/${current}/roster/${r.booking_id}`, {
                                          action: "check_in",
                                      }),
                                  ),
                              ),
                          { errorMessage: s.rosterError },
                      );
                  },
                  query,
                  setQuery,
                  matches:
                      t === ""
                          ? []
                          : clients
                                .filter((c) => !inClass.has(c.id))
                                .map((c) => ({
                                    clientId: c.id,
                                    name: c.name,
                                    pet: c.pet_name ?? "",
                                    petId: c.pet_id,
                                }))
                                .filter((m) =>
                                    [m.name, m.pet].some((v) => v.toLowerCase().includes(t)),
                                )
                                .slice(0, 4),
                  add: (clientId) => {
                      if (current === null) return;
                      const c = clients.find((x) => x.id === clientId);
                      const label = c?.pet_name ?? c?.name ?? "";
                      setQuery("");
                      run(
                          async () => {
                              const out = await api.post<{ status: string }>(
                                  `/v1/classes/${current}/roster`,
                                  {
                                      client_id: clientId,
                                      subject_id: c?.pet_id ?? null,
                                  },
                              );
                              setNotice(
                                  out.status === "waitlisted"
                                      ? s.addedWaitlist(label)
                                      : s.added(label),
                              );
                          },
                          { errorMessage: s.rosterError },
                      );
                  },
                  notice,
                  started: sameDay(session.start, now) || session.start <= now,
                  busy,
                  error,
              }
            : null,
    };
}

interface StationRow {
    id: string;
    name: string;
    category: string;
    active: number;
}

interface HeldRow {
    slot_id: string;
    resource_id: string;
    starts_at: string;
    ends_at: string;
    pet_name: string | null;
    client_name: string | null;
    item_name: string;
}

export const STATIONS_SQL =
    "SELECT id, name, category, active FROM resources ORDER BY name COLLATE NOCASE";

export const STATIONS_HELD_SQL = `
SELECT s.id AS slot_id, s.resource_id, s.starts_at, s.ends_at, sj.name AS pet_name,
       c.name AS client_name, i.name AS item_name
FROM slots s JOIN items i ON i.id = s.item_id
LEFT JOIN bookings b ON b.slot_id = s.id AND b.deleted_at IS NULL AND b.status != 'canceled'
LEFT JOIN clients c ON c.id = b.client_id
LEFT JOIN subjects sj ON sj.id = b.subject_id
WHERE s.resource_id IS NOT NULL AND s.status != 'canceled'
  AND ${utcSql("s.starts_at")} < datetime(?) AND ${utcSql("s.ends_at")} > datetime(?)`;

interface StationChoice {
    key: string;
    label: string;
    hint: string;
    disabled: boolean;
}

export interface StationPicker {
    options: StationChoice[];
    value: string;
    setValue: (id: string) => void;
    changed: boolean;
    save: () => void;
    busy: boolean;
    error: string | null;
}

/** Stations for one visit: a taken one says who has it then; picking one moves the visit onto it. */
export function useStationPicker(
    api: ApiLike,
    visit: ScheduleEvent,
    onSaved: () => void,
): StationPicker {
    const stations = useQuery<StationRow>(STATIONS_SQL).data;
    const held = useQuery<HeldRow>(STATIONS_HELD_SQL, [
        visit.end.toISOString(),
        visit.start.toISOString(),
    ]).data;
    const [value, setValue] = useState(visit.resourceId ?? "");
    const { busy, error, run } = useAsyncAction();
    const options = stations
        .filter((r) => r.category !== "room" && (r.active === 1 || r.id === visit.resourceId))
        .map((r) => {
            const clash = held.find((h) => h.resource_id === r.id && h.slot_id !== visit.slotId);
            const start = clash ? parseTimestamp(clash.starts_at) : null;
            const end = clash ? parseTimestamp(clash.ends_at) : null;
            return {
                key: r.id,
                label: r.name,
                hint:
                    clash && start && end
                        ? s.takenBy(
                              clash.pet_name ?? clash.client_name ?? clash.item_name,
                              `${formatTime(start)} – ${formatTime(end)}`,
                          )
                        : s.freeThen,
                disabled: clash !== undefined,
            };
        });
    return {
        options,
        value,
        setValue,
        changed: value !== (visit.resourceId ?? ""),
        save: () => {
            if (visit.bookingId === null) return;
            const bookingId = visit.bookingId;
            run(
                () =>
                    api.patch(`/v1/bookings/${bookingId}`, {
                        resource_id: value === "" ? null : value,
                    }),
                {
                    onSuccess: onSaved,
                    errorMessage: s.stationError,
                },
            );
        },
        busy,
        error,
    };
}
