import { historyStart } from "@clientbridge/sync";
import { personMedia, usePeoplePhotos } from "./files";

import { useBusinessQuery as useQuery } from "../hooks";

import { useEffect, useMemo, useRef, useState } from "react";

import { type ApiLike, type Attempt, attemptKey, failureMessage } from "../api";
import {
    formatDate,
    formatDateTime,
    formatRelativeTime,
    formatTime,
    formatWeekdayTime,
    parseTimestamp,
    relativeDay,
    sameDay,
    useBusinessZone,
    utcSql,
} from "../datetime";
import { formatParts, formatPhone } from "../format";
import { isConnectionFailure, type Load, useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { Intent, SelectOption } from "../ui";
import { type ChannelConsent, consentFor, smsSegments, useConsents } from "./broadcasts";
import { useClients } from "./clients";
import { staffNameSql } from "./staff";
import { useReplicaLoad } from "./sync";

export type Channel = "sms" | "email";

const m = strings.messaging;

interface ThreadRow {
    id: string;
    client_id: string;
    channel: string;
    last_message_at: string | null;
    unread_count: number;
    status: string;
    client_name: string | null;
    last_body: string | null;
}

export const THREADS_SQL = `
SELECT t.id, t.client_id, t.channel,
       (SELECT MAX(m.created_at) FROM messages m WHERE m.thread_id = t.id) AS last_message_at,
       (SELECT COUNT(*) FROM messages m
        WHERE m.thread_id = t.id AND m.direction = 'in' AND m.status != 'read') AS unread_count,
       t.status,
       c.name AS client_name,
       (SELECT m.body FROM messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1)
           AS last_body
FROM threads t
LEFT JOIN clients c ON c.id = t.client_id
ORDER BY last_message_at DESC`;

/** LEFT join so a deleted client's threads still list. */
export function useThreads(): ThreadRow[] {
    return useQuery<ThreadRow>(THREADS_SQL).data;
}

export const INBOX_SQL = `
SELECT t.id, t.client_id, t.channel, t.status, c.name AS client_name, c.phone, c.email,
       (SELECT MAX(m.created_at) FROM messages m WHERE m.thread_id = t.id) AS last_message_at,
       (SELECT COUNT(*) FROM messages m
        WHERE m.thread_id = t.id AND m.direction = 'in' AND m.status != 'read') AS unread_count,
       (SELECT m.body FROM messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1)
           AS last_body,
       (SELECT GROUP_CONCAT(s.name, ', ') FROM subjects s WHERE s.client_id = t.client_id)
           AS subject_names
FROM threads t
LEFT JOIN clients c ON c.id = t.client_id
ORDER BY last_message_at DESC`;

export const CONVERSATION_SQL = `
SELECT m.id, m.direction, m.channel, m.body, m.status, m.created_at, ${staffNameSql("st")} AS author
FROM messages m LEFT JOIN staff st ON st.user_id = m.sent_by
WHERE m.thread_id = ? ORDER BY m.created_at`;

// The client beside a thread: contact, subjects, what they owe and their next visit after `?`.
export const INBOX_CLIENT_SQL = `
SELECT c.id, c.name, c.email, c.phone,
       (SELECT GROUP_CONCAT(s.name, ', ') FROM subjects s WHERE s.client_id = c.id) AS subject_names,
       (SELECT SUM(a.balance_cents) FROM accounts a WHERE a.owner_type = 'client'
          AND a.owner_id = c.id AND a.category = 'receivable') AS balance_cents,
       (SELECT sl.starts_at FROM bookings b JOIN slots sl ON sl.id = b.slot_id
        WHERE b.client_id = c.id AND b.status IN ('pending', 'confirmed') AND ${utcSql("sl.starts_at")} > datetime(?)
        ORDER BY ${utcSql("sl.starts_at")} LIMIT 1) AS next_at,
       (SELECT i.name FROM bookings b JOIN slots sl ON sl.id = b.slot_id
        JOIN items i ON i.id = sl.item_id
        WHERE b.client_id = c.id AND b.status IN ('pending', 'confirmed') AND ${utcSql("sl.starts_at")} > datetime(?)
        ORDER BY ${utcSql("sl.starts_at")} LIMIT 1) AS next_service
FROM clients c WHERE c.id = ?`;

interface InboxRow {
    id: string;
    client_id: string;
    channel: string;
    status: string;
    client_name: string | null;
    phone: string | null;
    email: string | null;
    last_message_at: string | null;
    unread_count: number;
    last_body: string | null;
    subject_names: string | null;
}

export interface InboxThread extends InboxRow {
    title: string;
    ago: string;
    subjects: string[];
    // The client replied STOP: texts are blocked until they reply START.
    textsOff: boolean;
    channelKind: "sms" | "email";
}

export function resolveInboxTarget(
    threads: readonly Pick<InboxThread, "id" | "client_id">[],
    target: { threadId?: string | undefined; clientId?: string | undefined },
): { threadId: string | null; clientId: string | null } {
    const thread =
        target.threadId !== undefined
            ? threads.find((item) => item.id === target.threadId)
            : threads.find((item) => item.client_id === target.clientId);
    return {
        threadId: thread?.id ?? null,
        clientId:
            thread === undefined && target.threadId === undefined
                ? (target.clientId ?? null)
                : null,
    };
}

type InboxFilter = "all" | "unread" | "sms" | "email";

export const INBOX_FILTERS: { key: InboxFilter; label: string }[] = [
    {
        key: "all",
        get label() {
            return m.filters.all;
        },
    },
    {
        key: "unread",
        get label() {
            return m.filters.unread;
        },
    },
    {
        key: "sms",
        get label() {
            return m.filters.sms;
        },
    },
    {
        key: "email",
        get label() {
            return m.filters.email;
        },
    },
];

export function quickReplies(): { key: string; label: string; text: string }[] {
    return m.quickReplyOptions.map((q, i) => ({ key: String(i), label: q.label, text: q.text }));
}

export function channelLabel(channel: string): string {
    if (channel === "sms") return m.channelSms;
    if (channel === "email") return m.channelEmail;
    return channel;
}

const stopped = (c: ChannelConsent): boolean => c.state === "opted_out" && c.source === "reply";

interface InboxView {
    load: Load;
    threads: InboxThread[];
    filtered: InboxThread[];
    filter: InboxFilter;
    setFilter: (f: InboxFilter) => void;
    q: string;
    setQ: (q: string) => void;
    unread: number;
}

export function useInbox(): InboxView {
    const rows = useQuery<InboxRow>(INBOX_SQL);
    const consents = useConsents();
    const zone = useBusinessZone();
    const [filter, setFilter] = useState<InboxFilter>("all");
    const [q, setQ] = useState("");
    const threads = useMemo(() => {
        const now = new Date();
        return rows.data.map((t) => ({
            ...t,
            title: t.client_name ?? formatPhone(t.phone),
            ago: t.last_message_at === null ? "" : formatRelativeTime(t.last_message_at, zone, now),
            subjects: t.subject_names === null ? [] : t.subject_names.split(", "),
            textsOff: stopped(consentFor(consents.map, t.client_id, "sms")),
            channelKind: t.channel === "email" ? ("email" as const) : ("sms" as const),
        }));
    }, [rows.data, consents.map, zone]);
    const filtered = useMemo(() => {
        const term = q.trim().toLowerCase();
        return threads.filter(
            (t) =>
                (filter === "all" ||
                    (filter === "unread" && t.unread_count > 0) ||
                    t.channel === filter) &&
                (term === "" ||
                    [t.title, t.last_body ?? "", ...t.subjects].some((v) =>
                        v.toLowerCase().includes(term),
                    )),
        );
    }, [threads, filter, q]);
    return {
        load: useReplicaLoad([rows], rows.data.length === 0),
        threads,
        filtered,
        filter,
        setFilter,
        q,
        setQ,
        unread: threads.filter((t) => t.unread_count > 0).length,
    };
}

interface ConversationRow {
    id: string;
    direction: string;
    channel: string;
    body: string | null;
    status: string;
    created_at: string;
    author: string | null;
}

interface ThreadItem {
    id: string;
    direction: "in" | "out";
    body: string;
    meta: string;
    failed: boolean;
}

interface ClientContextRow {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    subject_names: string | null;
    balance_cents: number | null;
    next_at: string | null;
    next_service: string | null;
}

export interface Conversation {
    days: { label: string; items: ThreadItem[] }[];
    client: ClientContextRow | null;
    consent: Record<Channel, ChannelConsent>;
    nextVisit: string | null;
    // messages older than this device keeps, fetched page by page while online
    earlier: { show: boolean; busy: boolean; error: string | null; load: () => void };
}

interface ConversationPage {
    messages: ConversationRow[];
    more: boolean;
}

const MESSAGE_STATUS: Record<string, string> = {
    get delivered() {
        return m.thread.status.delivered;
    },
    get sent() {
        return m.thread.status.sent;
    },
    get read() {
        return m.thread.status.delivered;
    },
    get failed() {
        return m.thread.status.failed;
    },
    get queued() {
        return m.thread.status.queued;
    },
};

/** "Today, 2:30 p.m." or "Fri 9:00 a.m." for a visit in the coming week, else the date. */
function visitWhen(d: Date, now: Date, zone: string): string {
    if (sameDay(d, now, zone))
        return strings.common.dayAndTime(strings.common.today, formatTime(d, zone));
    return d.getTime() - now.getTime() < 6 * 86_400_000
        ? formatWeekdayTime(d, zone)
        : formatDateTime(d, zone);
}

/** Messages grouped by day; outbound ones carry who sent them, or Automatic for the system. */
export function useConversation(api: ApiLike, thread: InboxThread): Conversation {
    const now = useMemo(() => new Date(), []);
    const zone = useBusinessZone();
    const iso = now.toISOString();
    const local = useQuery<ConversationRow>(CONVERSATION_SQL, [thread.id]).data;
    const [older, setOlder] = useState<{ thread: string; rows: ConversationRow[]; more: boolean }>({
        thread: thread.id,
        rows: [],
        more: true,
    });
    const earlier = older.thread === thread.id ? older : { rows: [], more: true };
    const fetching = useAsyncAction();
    const loadEarlier = (): void => {
        const oldest = earlier.rows[0] ?? local[0];
        const params = new URLSearchParams({
            before: oldest?.created_at.replace(" ", "T") ?? historyStart(now).toISOString(),
        });
        if (earlier.rows[0] !== undefined) params.set("before_id", earlier.rows[0].id);
        fetching.run(
            async () => {
                const page = await api.get<ConversationPage>(
                    `/v1/threads/${thread.id}/messages?${params.toString()}`,
                );
                const known = new Set(local.map((r) => r.id));
                setOlder({
                    thread: thread.id,
                    rows: [
                        ...page.messages.filter((r) => !known.has(r.id)).reverse(),
                        ...earlier.rows,
                    ],
                    more: page.more,
                });
            },
            {
                errorMessage: (error) =>
                    isConnectionFailure(error) ? m.thread.earlierOffline : m.thread.earlierFailed,
            },
        );
    };
    const rows = useMemo(
        () =>
            [...new Map([...earlier.rows, ...local].map((row) => [row.id, row])).values()].sort(
                (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
            ),
        [earlier.rows, local],
    );
    const client =
        useQuery<ClientContextRow>(INBOX_CLIENT_SQL, [iso, iso, thread.client_id]).data[0] ?? null;
    const consents = useConsents();
    const days = useMemo(() => {
        const out: Conversation["days"] = [];
        for (const r of rows) {
            const d = parseTimestamp(r.created_at);
            const label = relativeDay(d, zone, "long");
            const author = r.author === null ? m.thread.automatic : r.author.split(" ")[0];
            const meta =
                r.direction === "out"
                    ? formatParts([formatTime(d, zone), author, MESSAGE_STATUS[r.status] ?? null])
                    : formatTime(d, zone);
            const item: ThreadItem = {
                id: r.id,
                direction: r.direction === "in" ? "in" : "out",
                body: r.body ?? "",
                meta,
                failed: r.status === "failed",
            };
            const last = out[out.length - 1];
            if (last?.label === label) last.items.push(item);
            else out.push({ label, items: [item] });
        }
        return out;
    }, [rows, zone]);
    return {
        days,
        client,
        consent: {
            sms: consentFor(consents.map, thread.client_id, "sms"),
            email: consentFor(consents.map, thread.client_id, "email"),
        },
        nextVisit:
            client?.next_at === null || client === null
                ? null
                : formatParts([
                      client.next_service,
                      visitWhen(parseTimestamp(client.next_at), now, zone),
                  ]),
        earlier: {
            show: earlier.more,
            busy: fetching.busy,
            error: fetching.error,
            load: loadEarlier,
        },
    };
}

export function consentDetail(c: ChannelConsent, zone: string): string | null {
    const b = strings.broadcasts;
    if (c.state === "implied" && c.expiresAt !== null)
        return m.consentImpliedUntil(formatDate(parseTimestamp(c.expiresAt), zone));
    if (c.source !== null && c.at !== null)
        return b.consentSource(
            b.sources[c.source] ?? c.source,
            formatDate(parseTimestamp(c.at), zone),
        );
    return null;
}

export function consentLabel(c: ChannelConsent): { label: string; intent: Intent } {
    switch (c.state) {
        case "express":
            return { label: m.consentState.express, intent: "success" };
        case "implied":
            return { label: m.consentState.implied, intent: "accent" };
        case "opted_out":
            return { label: m.consentState.opted_out, intent: "danger" };
        default:
            return { label: m.consentState.none, intent: "neutral" };
    }
}

function markThreadRead(api: ApiLike, threadId: string): Promise<unknown> {
    return api.post(`/v1/threads/${threadId}/read`, {});
}

/** Marks the open thread read on open, and again when new inbound messages arrive. */
export function useMarkThreadRead(
    api: ApiLike,
    thread: { id: string; unread_count: number },
): void {
    useEffect(() => {
        if (thread.unread_count > 0) markThreadRead(api, thread.id).catch(() => undefined);
    }, [api, thread.id, thread.unread_count]);
}

class NotDelivered extends Error {}

async function sendMessage(
    api: ApiLike,
    input: { client_id: string; channel: Channel; body: string; booking_id?: string },
    attempt: { current: Attempt | null },
): Promise<void> {
    const sent = await api.post<{ status: string }>("/v1/messages", input, {
        idempotencyKey: attemptKey(attempt, input),
    });
    if (sent.status === "failed") {
        // the failed message is recorded, so trying again is a new message rather than a replay
        attempt.current = null;
        throw new NotDelivered();
    }
}

function sendFailure(e: unknown): string {
    return e instanceof NotDelivered ? m.notDelivered : failureMessage(e, m.sendError);
}

export interface ThreadComposer {
    channel: Channel;
    setChannel: (c: Channel) => void;
    body: string;
    setBody: (v: string) => void;
    busy: boolean;
    error: string | null;
    submit: () => void;
    segments: { chars: number; segments: number };
    smsBlocked: boolean;
    canSend: boolean;
}

/** A STOP reply blocks texts; email still reaches the client. */
export function useThreadComposer(api: ApiLike, thread: InboxThread): ThreadComposer {
    const [channel, setChannel] = useState<Channel>(
        thread.textsOff || thread.channel === "email" ? "email" : "sms",
    );
    const [body, setBody] = useState("");
    const { busy, error, setError, run } = useAsyncAction();
    const attempt = useRef<Attempt | null>(null);
    const smsBlocked = thread.textsOff && channel === "sms";
    const canSend = !smsBlocked && body.trim().length > 0;
    return {
        channel,
        setChannel: (c) => {
            setError(null);
            setChannel(c);
        },
        body,
        setBody,
        busy,
        error,
        submit: () => {
            if (!canSend) return;
            run(
                () =>
                    sendMessage(
                        api,
                        {
                            client_id: thread.client_id,
                            channel,
                            body: body.trim(),
                        },
                        attempt,
                    ),
                {
                    onSuccess: () => {
                        attempt.current = null;
                        setBody("");
                    },
                    errorMessage: sendFailure,
                },
            );
        },
        segments: smsSegments(body),
        smsBlocked,
        canSend,
    };
}

interface NewMessage {
    clients: SelectOption<string>[];
    clientId: string;
    setClientId: (id: string) => void;
    channel: Channel;
    setChannel: (c: Channel) => void;
    body: string;
    setBody: (v: string) => void;
    smsBlocked: boolean;
    segments: { chars: number; segments: number };
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** Picks email when the client replied STOP to texts or never agreed to them. */
export function useNewMessage(
    api: ApiLike,
    onSent: (sent: { clientId: string; name: string }) => void,
    initialClientId = "",
): NewMessage {
    const photos = usePeoplePhotos();
    const clients = useClients();
    const consents = useConsents();
    const [clientId, setClientIdRaw] = useState(initialClientId);
    const [channel, setChannel] = useState<Channel>("sms");
    const [body, setBody] = useState("");
    const { busy, error, setError, run } = useAsyncAction();
    const attempt = useRef<Attempt | null>(null);
    const sms = consentFor(consents.map, clientId, "sms");
    const smsBlocked = channel === "sms" && stopped(sms);
    return {
        clients: clients.map((c) => ({
            key: c.id,
            label: c.name,
            media: personMedia(c.name, null, photos.client(c.id)),
        })),
        clientId,
        setClientId: (id) => {
            setClientIdRaw(id);
            setError(null);
            setChannel(stopped(consentFor(consents.map, id, "sms")) ? "email" : "sms");
        },
        channel,
        setChannel,
        body,
        setBody,
        smsBlocked,
        segments: smsSegments(body),
        busy,
        error,
        submit: () => {
            if (clientId === "") {
                setError(m.selectClient);
                return;
            }
            if (body.trim() === "") {
                setError(m.writeMessage);
                return;
            }
            if (smsBlocked) return;
            const name = clients.find((c) => c.id === clientId)?.name ?? "";
            run(
                () =>
                    sendMessage(api, { client_id: clientId, channel, body: body.trim() }, attempt),
                {
                    onSuccess: () => {
                        attempt.current = null;
                        setBody("");
                        onSent({ clientId, name });
                    },
                    errorMessage: sendFailure,
                },
            );
        },
    };
}

const SHARED_PHOTOS_SQL = `
SELECT COUNT(*) AS n FROM files
WHERE parent_type = 'booking' AND parent_id = ? AND uploaded_at IS NOT NULL
  AND shared_at IS NOT NULL`;

interface VisitNote {
    body: string;
    sharedPhotos: number;
    setBody: (v: string) => void;
    busy: boolean;
    error: string | null;
    sent: boolean;
    submit: () => void;
}

/** A short note to the client on how a visit went, sent with the link to its page and photos. */
export function useVisitNote(
    api: ApiLike,
    clientId: string | null,
    bookingId: string | null,
): VisitNote {
    const consents = useConsents();
    const sharedPhotos =
        useQuery<{ n: number }>(SHARED_PHOTOS_SQL, [bookingId ?? ""]).data[0]?.n ?? 0;
    const [body, setBody] = useState("");
    const [sent, setSent] = useState(false);
    const { busy, error, setError, run } = useAsyncAction();
    const attempt = useRef<Attempt | null>(null);
    return {
        body,
        sharedPhotos,
        setBody: (v) => {
            setError(null);
            setSent(false);
            setBody(v);
        },
        busy,
        error,
        sent,
        submit: () => {
            if (clientId === null || bookingId === null || body.trim() === "") return;
            const channel: Channel = stopped(consentFor(consents.map, clientId, "sms"))
                ? "email"
                : "sms";
            run(
                () =>
                    sendMessage(
                        api,
                        { client_id: clientId, channel, body: body.trim(), booking_id: bookingId },
                        attempt,
                    ),
                {
                    onSuccess: () => {
                        attempt.current = null;
                        setBody("");
                        setSent(true);
                    },
                    errorMessage: sendFailure,
                },
            );
        },
    };
}
