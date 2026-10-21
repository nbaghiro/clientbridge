import { useBusinessQuery as useQuery } from "../hooks";

import { useState } from "react";

import type { ApiLike } from "../api";
import {
    addDays,
    formatTime,
    formatWeekdayTime,
    parseTimestamp,
    sameDay,
    startOfDay,
    useBusinessZone,
} from "../datetime";
import { type Load, useAsyncAction, useRemote } from "../hooks";
import { strings } from "../strings";
import { type ScheduleEvent, needsClosing, useScheduleEvents } from "./bookings";
import { useNow } from "../hooks";
import { utcSql } from "../datetime";
import { useReplicaLoad } from "./sync";

const s = strings.reminders;

interface ReminderPreviewOut {
    subject: string;
    body: string;
    sends_at: string;
    sent_at: string | null;
}

export const REMINDERS_SENT_SQL = `
SELECT COUNT(*) AS sent FROM bookings
WHERE reminded_at IS NOT NULL AND ${utcSql("reminded_at")} > datetime(?)`;

interface PolicyOut {
    policy: { self_service: boolean; auto_complete: boolean };
}

interface ReminderSettings {
    manageLink: boolean;
    autoComplete: boolean;
    preview: { subject: string; body: string; sendsAt: string; who: string } | null;
    previewLoading: boolean;
    sentWeek: number;
    openToday: ScheduleEvent[];
    openEarlier: ScheduleEvent[];
    close: (event: ScheduleEvent, status: "completed" | "no_show") => void;
    closing: string | null;
    error: string | null;
    load: Load;
}

const when = (d: Date, now: Date, zone: string): string =>
    sameDay(d, now, zone) ? formatTime(d, zone) : formatWeekdayTime(d, zone);

/** The reminder every visit gets, shown word for word for the next visit, and visits left open. */
export function useReminderSettings(api: ApiLike): ReminderSettings {
    const now = useNow();
    const zone = useBusinessZone();
    const today = startOfDay(now, zone);
    const { events, isLoading, error } = useScheduleEvents(
        addDays(today, -14, zone),
        addDays(today, 30, zone),
    );
    const weekAgo = addDays(now, -7, zone).toISOString();
    const sent = useQuery<{ sent: number }>(REMINDERS_SENT_SQL, [weekAgo]);
    const next = events.find(
        (e) =>
            e.kind === "visit" &&
            e.bookingId !== null &&
            e.start > now &&
            (e.status === "confirmed" || e.status === "pending"),
    );
    const remote = useRemote(
        () =>
            next?.bookingId
                ? api.get<ReminderPreviewOut>(`/v1/bookings/${next.bookingId}/reminder`)
                : Promise.resolve(null),
        next?.bookingId ?? "",
    );
    const policy = useRemote(() => api.get<PolicyOut>("/v1/online-booking"));
    const closer = useAsyncAction();
    const [closing, setClosing] = useState<string | null>(null);
    const open = needsClosing(events);
    const load = useReplicaLoad([{ isLoading, error }, sent], false);
    const data = remote.data;
    return {
        manageLink: policy.data?.policy.self_service ?? false,
        autoComplete: policy.data?.policy.auto_complete ?? false,
        preview:
            data && next
                ? {
                      subject: data.subject,
                      body: data.body,
                      sendsAt: data.sent_at
                          ? s.sentAt(when(parseTimestamp(data.sent_at), now, zone))
                          : s.sendsAt(when(parseTimestamp(data.sends_at), now, zone)),
                      who: next.clientName ?? next.headline,
                  }
                : null,
        previewLoading: remote.isLoading,
        sentWeek: sent.data[0]?.sent ?? 0,
        openToday: open.filter((e) => sameDay(e.start, now, zone)),
        openEarlier: open.filter((e) => e.start < today),
        close: (event, status) => {
            if (event.bookingId === null) return;
            const bookingId = event.bookingId;
            setClosing(event.id);
            closer.run(() => api.patch(`/v1/bookings/${bookingId}`, { status }), {
                onSuccess: () => {
                    setClosing(null);
                },
                errorMessage: s.actionError,
            });
        },
        closing: closer.busy ? closing : null,
        error: closer.error,
        load,
    };
}
