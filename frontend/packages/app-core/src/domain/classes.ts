import { formatParts } from "../format";
import { useBusinessQuery as useQuery } from "../hooks";

import { useState } from "react";

import { type ApiLike, failureMessage } from "../api";
import {
    addDays,
    formatTimeRange,
    parseTimestamp,
    relativeDay,
    sameDay,
    startOfDay,
    useBusinessZone,
} from "../datetime";
import { type Load, useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { Intent } from "../ui";
import { slotOverlapSql, useNow } from "./bookings";
import { staffName, useStaff } from "./staff";
import { parseAttributes, subjectSummary, subjectTemperament, useSubjectKind } from "./subjects";
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
}

interface RosterRow {
    booking_id: string;
    slot_id: string;
    client_id: string;
    client_name: string;
    client_phone: string | null;
    client_email: string | null;
    subject_name: string | null;
    subject_attributes: string | null;
    status: string;
    checked_in_at: string | null;
    deposit_status: string;
}

export const CLASS_SESSIONS_SQL = `
SELECT s.id AS slot_id, s.starts_at, s.ends_at, s.capacity, s.staff_id,
       i.name AS item_name, i.color AS item_color
FROM slots s JOIN items i ON i.id = s.item_id
WHERE s.capacity > 1 AND s.status != 'canceled' AND ${slotOverlapSql("?1", "?2")}
ORDER BY s.starts_at`;

export const CLASS_ROSTER_SQL = `
SELECT b.id AS booking_id, b.slot_id, b.client_id, c.name AS client_name, c.phone AS client_phone,
       c.email AS client_email, sj.name AS subject_name, sj.attributes AS subject_attributes, b.status,
       b.checked_in_at, b.deposit_status
FROM bookings b JOIN slots s ON s.id = b.slot_id JOIN clients c ON c.id = b.client_id
LEFT JOIN subjects sj ON sj.id = b.subject_id
WHERE s.capacity > 1 AND b.status != 'canceled' AND b.deleted_at IS NULL
  AND ${slotOverlapSql("?1", "?2")}
ORDER BY b.created_at`;

export const CLASS_CLIENTS_SQL = `
SELECT c.id, c.name,
       (SELECT sj.id FROM subjects sj WHERE sj.client_id = c.id AND sj.deleted_at IS NULL
          ORDER BY sj.name LIMIT 1) AS subject_id,
       (SELECT sj.name FROM subjects sj WHERE sj.client_id = c.id AND sj.deleted_at IS NULL
          ORDER BY sj.name LIMIT 1) AS subject_name
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
    subjectName: string;
    subjectDetail: string;
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
    matches: { clientId: string; name: string; subjectName: string; subjectId: string | null }[];
    add: (clientId: string) => void;
    notice: string | null;
    started: boolean;
    busy: boolean;
    error: string | null;
}

const STATUS: Record<RosterStatus, { label: string; intent: Intent }> = {
    confirmed: {
        get label() {
            return s.statusBooked;
        },
        intent: "accent",
    },
    checked_in: {
        get label() {
            return s.statusHere;
        },
        intent: "success",
    },
    no_show: {
        get label() {
            return s.statusNoShow;
        },
        intent: "danger",
    },
    waitlist: {
        get label() {
            return s.statusWaiting;
        },
        intent: "neutral",
    },
};

export function rosterStatus(r: RosterRow): RosterStatus {
    if (r.status === "waitlisted") return "waitlist";
    if (r.status === "no_show") return "no_show";
    return r.checked_in_at !== null ? "checked_in" : "confirmed";
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
    const zone = useBusinessZone();
    const from = startOfDay(now, zone);
    const range = [from.toISOString(), addDays(from, 21, zone).toISOString()];
    const sessionsQ = useQuery<SessionRow>(CLASS_SESSIONS_SQL, range);
    const rosterQ = useQuery<RosterRow>(CLASS_ROSTER_SQL, range);
    const clients = useQuery<{
        id: string;
        name: string;
        subject_id: string | null;
        subject_name: string | null;
    }>(CLASS_CLIENTS_SQL).data;
    const kind = useSubjectKind();
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
            when: formatParts([relativeDay(start, zone), formatTimeRange(start, end, zone)]),
            day: relativeDay(start, zone),
            time: formatTimeRange(start, end, zone),
            staffName: member ? staffName(member) : "",
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
        const attrs = parseAttributes(r.subject_attributes);
        const temperament = subjectTemperament(kind, attrs);
        const status = rosterStatus(r);
        return {
            key: r.booking_id,
            clientId: r.client_id,
            clientName: r.client_name,
            subjectName: r.subject_name ?? r.client_name,
            subjectDetail: formatParts([
                subjectSummary(kind, attrs, zone),
                temperament?.label ?? "",
            ]),
            status,
            statusLabel: STATUS[status].label,
            intent: STATUS[status].intent,
            paid: r.deposit_status !== "pending",
            note: temperament?.nervous === true ? s.gentleNote : null,
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
            errorMessage: (e) => failureMessage(e, s.rosterError),
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
                                    subjectName: kind === null ? "" : (c.subject_name ?? ""),
                                    subjectId: kind === null ? null : c.subject_id,
                                }))
                                .filter((m) =>
                                    [m.name, m.subjectName].some((v) =>
                                        v.toLowerCase().includes(t),
                                    ),
                                )
                                .slice(0, 4),
                  add: (clientId) => {
                      if (current === null) return;
                      const c = clients.find((x) => x.id === clientId);
                      const subjectId = kind === null ? null : (c?.subject_id ?? null);
                      const label = (subjectId === null ? null : c?.subject_name) ?? c?.name ?? "";
                      setQuery("");
                      run(
                          async () => {
                              const out = await api.post<{ status: string }>(
                                  `/v1/classes/${current}/roster`,
                                  {
                                      client_id: clientId,
                                      subject_id: subjectId,
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
                  started: sameDay(session.start, now, zone) || session.start <= now,
                  busy,
                  error,
              }
            : null,
    };
}
