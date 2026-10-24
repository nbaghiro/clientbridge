import { BUSINESS_CURRENCY, formatMoney, formatParts } from "../format";
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
import { slotOverlapSql } from "./bookings";
import { afterReview } from "./previews";
import { useNow } from "../hooks";
import { resourceName, useResources } from "./resources";
import { staffName, useStaff } from "./staff";
import {
    type SubjectKind,
    parseAttributes,
    pickupLine,
    subjectSummary,
    subjectTemperament,
    useSubjectKind,
} from "./subjects";
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
    program_id: string | null;
    resource_id: string | null;
}

export interface RosterRow {
    booking_id: string;
    slot_id: string;
    client_id: string;
    subject_id: string | null;
    client_name: string;
    client_phone: string | null;
    client_email: string | null;
    subject_name: string | null;
    subject_attributes: string | null;
    status: string;
    checked_in_at: string | null;
    deposit_status: string;
    deposit_amount_cents: number | null;
}

export const CLASS_SESSIONS_SQL = `
SELECT s.id AS slot_id, s.starts_at, s.ends_at, s.capacity, s.staff_id, s.resource_id,
       i.name AS item_name, i.color AS item_color,
       (SELECT r.id FROM recurrences r WHERE r.id = s.recurrence_id AND r.client_id IS NULL
          AND i.session_count IS NOT NULL) AS program_id
FROM slots s JOIN items i ON i.id = s.item_id
WHERE s.capacity > 1 AND s.status != 'canceled' AND ${slotOverlapSql("?1", "?2")}
ORDER BY s.starts_at`;

export const CLASS_ROSTER_SQL = `
SELECT b.id AS booking_id, b.slot_id, b.client_id, b.subject_id, c.name AS client_name,
       c.phone AS client_phone,
       c.email AS client_email, sj.name AS subject_name, sj.attributes AS subject_attributes, b.status,
       b.checked_in_at, b.deposit_status, b.deposit_amount_cents
FROM bookings b JOIN slots s ON s.id = b.slot_id JOIN clients c ON c.id = b.client_id
LEFT JOIN subjects sj ON sj.id = b.subject_id
WHERE s.capacity > 1 AND b.status != 'canceled' AND b.deleted_at IS NULL
  AND ${slotOverlapSql("?1", "?2")}
ORDER BY b.created_at, b.id`;

// One row per client and subject, so siblings can each take a seat.
export const CLASS_CLIENTS_SQL = `
SELECT c.id, c.name, sj.id AS subject_id, sj.name AS subject_name
FROM clients c LEFT JOIN subjects sj ON sj.client_id = c.id AND sj.deleted_at IS NULL
WHERE c.status = 'active' ORDER BY c.name COLLATE NOCASE, sj.name COLLATE NOCASE`;

export interface SeatCandidate {
    id: string;
    name: string;
    subject_id: string | null;
    subject_name: string | null;
}

export interface SeatMatch {
    key: string;
    clientId: string;
    subjectId: string | null;
    name: string;
    subjectName: string;
    // the row's title, "Rex · Ann Lee", and the name its avatar shows
    title: string;
    avatar: string;
}

/** A seat's holder: the subject when the business books one, else the client. */
export const seatKey = (clientId: string, subjectId: string | null): string =>
    `${clientId}:${subjectId ?? ""}`;

/** Clients (and each of their subjects) matching a search, leaving out those already seated. */
export function seatMatches(
    candidates: readonly SeatCandidate[],
    query: string,
    seated: ReadonlySet<string>,
    booksSubjects: boolean,
): SeatMatch[] {
    const t = query.trim().toLowerCase();
    if (t === "") return [];
    const seen = new Set<string>();
    const out: SeatMatch[] = [];
    for (const c of candidates) {
        const subjectId = booksSubjects ? c.subject_id : null;
        const key = seatKey(c.id, subjectId);
        if (seen.has(key) || seated.has(key)) continue;
        seen.add(key);
        const subjectName = booksSubjects ? (c.subject_name ?? "") : "";
        if (![c.name, subjectName].some((v) => v.toLowerCase().includes(t))) continue;
        out.push({
            key,
            clientId: c.id,
            subjectId,
            name: c.name,
            subjectName,
            title: subjectName === "" ? c.name : formatParts([subjectName, c.name]),
            avatar: subjectName === "" ? c.name : subjectName,
        });
    }
    return out.slice(0, 4);
}

/** One person on a session's roster, with their subject's details and pickups. */
export function rosterEntry(kind: SubjectKind | null, zone: string, r: RosterRow): RosterEntry {
    const attrs = parseAttributes(r.subject_attributes);
    const temperament = subjectTemperament(kind, attrs);
    const status = rosterStatus(r);
    return {
        key: r.booking_id,
        clientId: r.client_id,
        clientName: r.client_name,
        subjectName: r.subject_name ?? r.client_name,
        subjectDetail: formatParts([subjectSummary(kind, attrs, zone), temperament?.label ?? ""]),
        status,
        statusLabel: STATUS[status].label,
        intent: STATUS[status].intent,
        paid: r.deposit_status !== "pending",
        note: temperament?.nervous === true ? s.gentleNote : null,
        pickup: pickupLine(kind, attrs),
    };
}

export interface ClassSession {
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
    // set on a program's day, whose seats are taken and given back by enrolment
    programId: string | null;
    // the room or equipment the session holds for every seat
    room: string | null;
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
    pickup: string | null;
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
    matches: SeatMatch[];
    add: (key: string) => void;
    // set on a program's day, which takes no single seats and has no waitlist
    programNote: string | null;
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

/** One session's seats taken, people waiting and arrivals, ended sessions included. */
export function sessionCounts(rows: readonly RosterRow[]): {
    booked: number;
    waitlist: number;
    checkedIn: number;
} {
    const waitlist = rows.filter((b) => b.status === "waitlisted").length;
    return {
        booked: rows.length - waitlist,
        waitlist,
        checkedIn: rows.filter(
            (b) =>
                (b.status === "confirmed" || b.status === "completed") && b.checked_in_at !== null,
        ).length,
    };
}

interface ClassBoard {
    sessions: ClassSession[];
    summary: readonly { label: string; value: string }[];
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
    const clients = useQuery<SeatCandidate>(CLASS_CLIENTS_SQL).data;
    const kind = useSubjectKind();
    const staff = useStaff();
    const rooms = useResources();
    const [selected, setSelected] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [notice, setNotice] = useState<string | null>(null);
    const { busy, error, run } = useAsyncAction();
    const sender = useAsyncAction();
    const roster = rosterQ.data;

    const sessions: ClassSession[] = sessionsQ.data.map((r) => {
        const { booked, waitlist, checkedIn } = sessionCounts(
            roster.filter((b) => b.slot_id === r.slot_id),
        );
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
            room: resourceName(rooms, r.resource_id),
            capacity: r.capacity,
            booked,
            waitlist,
            checkedIn,
            full,
            seatsLabel: full
                ? waitlist > 0
                    ? s.fullWaiting(waitlist)
                    : s.full
                : s.seatsLeft(r.capacity - booked),
            intent: full ? "warning" : booked === 0 ? "neutral" : "accent",
            programId: r.program_id,
        };
    });
    const current = selected ?? sessions[0]?.slotId ?? null;
    const session = sessions.find((x) => x.slotId === current) ?? null;
    const mine = roster.filter((b) => b.slot_id === current);
    const entry = (r: RosterRow): RosterEntry => rosterEntry(kind, zone, r);
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
    const seated = new Set(
        mine.map((r) => seatKey(r.client_id, kind === null ? null : r.subject_id)),
    );
    const load = useReplicaLoad([sessionsQ, rosterQ], sessions.length === 0);

    const seats = sessions.reduce((n, x) => n + x.capacity, 0);
    const booked = sessions.reduce((n, x) => n + x.booked, 0);
    const waiting = sessions.reduce((n, x) => n + x.waitlist, 0);

    return {
        sessions,
        summary: [
            { label: s.summaryRange, value: s.summaryCount(sessions.length) },
            {
                label: s.summarySeats,
                value: seats === 0 ? strings.bookings.dash : s.seatsBooked(booked, seats),
            },
            { label: s.waitlist, value: s.summaryWaiting(waiting) },
        ],
        selected: current,
        select: (id) => {
            setSelected(id);
            setNotice(null);
            setQuery("");
        },
        load,
        messageClass: (body, onSent) => {
            if (body.trim() === "" || current === null) return;
            const slotId = current;
            const text = body.trim();
            afterReview(
                { title: s.review.messageTitle, message: text, confirmLabel: s.messageClassSend },
                () => {
                    sender.run(
                        async () => {
                            const out = await api.post<{ sent: number }>(
                                `/v1/classes/${slotId}/message`,
                                { body: text },
                            );
                            onSent(out.sent);
                        },
                        { errorMessage: s.rosterError },
                    );
                },
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
                      const r = mine.find((x) => x.booking_id === key);
                      const amount = formatMoney(r?.deposit_amount_cents ?? 0, BUSINESS_CURRENCY);
                      afterReview(
                          {
                              title: strings.bookings.noShowTitle,
                              message:
                                  r?.deposit_status === "pending"
                                      ? strings.bookings.noShowCharge(amount)
                                      : r?.deposit_status === "collected"
                                        ? strings.bookings.noShowKeep(amount)
                                        : strings.bookings.noShowNoDeposit,
                              confirmLabel: s.noShow,
                              destructive: true,
                          },
                          () => {
                              act(key, "no_show");
                          },
                      );
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
                  matches: seatMatches(clients, query, seated, kind !== null),
                  programNote: session.programId === null ? null : s.programDay(session.name),
                  add: (key) => {
                      if (current === null || session.programId !== null) return;
                      const m = seatMatches(clients, query, seated, kind !== null).find(
                          (x) => x.key === key,
                      );
                      if (m === undefined) return;
                      const clientId = m.clientId;
                      const subjectId = m.subjectId;
                      const label = m.subjectName === "" ? m.name : m.subjectName;
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
