import { useQuery } from "@powersync/react";
import { useMemo } from "react";

import { parseTimestamp } from "./datetime";
import type { CalendarEvent } from "./types";

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
}

// datetime() normalizes both the stored text and the ISO params to a comparable UTC form.
const SQL = `
SELECT s.id AS session_id, s.starts_at, s.ends_at, s.staff_id, s.capacity, s.booked_count,
       s.status AS session_status, i.name AS item_name, i.color AS item_color,
       b.id AS booking_id, b.status AS booking_status, c.name AS client_name
FROM sessions s
JOIN items i ON i.id = s.item_id
LEFT JOIN bookings b ON b.session_id = s.id AND b.deleted_at IS NULL
LEFT JOIN clients c ON c.id = b.client_id
WHERE s.status != 'canceled'
  AND datetime(s.starts_at) < datetime(?)
  AND datetime(s.ends_at) > datetime(?)`;

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
        color: r.item_color,
        capacity: r.capacity,
        bookedCount: r.booked_count,
    };
}

export function useCalendarEvents(
    rangeStart: Date,
    rangeEnd: Date,
    opts: { staffId?: string } = {},
): CalendarEvent[] {
    const { staffId } = opts;
    const sql = staffId ? `${SQL} AND s.staff_id = ?` : SQL;
    const startIso = rangeStart.toISOString();
    const endIso = rangeEnd.toISOString();
    const params = staffId ? [endIso, startIso, staffId] : [endIso, startIso];
    const { data } = useQuery<Row>(sql, params);
    return useMemo(() => data.map(toEvent), [data]);
}
