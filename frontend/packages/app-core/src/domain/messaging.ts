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
import { formatList, formatParts, formatPhone } from "../format";
import { isConnectionFailure, type Load, useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { Intent, SelectOption } from "../ui";
import {
    type MarketingConsent,
    consentFor,
    smsSegments,
    textsStopped,
    useConsents,
} from "./broadcasts";
import { useClients } from "./clients";
import { staffNameSql } from "./staff";
import { useReplicaLoad } from "./sync";

const m = strings.messaging;
// TextBody in the backend's schemas/messaging.py, which counts code points after trimming
const TEXT_MAX_LENGTH = 1000;

// past this many billed segments a composer says how many texts a message will send as
const SEGMENT_WARNING = 3;

/** How many texts a long message will go out as, or null while it fits in a few. */
export function segmentNote(body: string): string | null {
    const { segments } = smsSegments(body.trim());
    return segments > SEGMENT_WARNING ? m.manyTexts(segments) : null;
}

/** Why a text is too long to send, or null when the server will take it. */
export function textLengthError(body: string): string | null {
    const count = Array.from(body.trim()).length;
    return count > TEXT_MAX_LENGTH ? m.tooLong(TEXT_MAX_LENGTH, count) : null;
}

interface ThreadRow {
    id: string;
    client_id: string;
    last_message_at: string | null;
    unread_count: number;
    status: string;
    client_name: string | null;
    last_body: string | null;
}

export const THREADS_SQL = `
SELECT t.id, t.client_id,
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
SELECT t.id, t.client_id, t.status, t.created_at, c.name AS client_name, c.phone,
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
SELECT m.id, m.direction, m.body, m.status, m.created_at, ${staffNameSql("st")} AS author
FROM messages m LEFT JOIN staff st ON st.user_id = m.sent_by
WHERE m.thread_id = ? ORDER BY m.created_at`;

export const SHARED_NUMBER_SQL = `
SELECT o.name FROM clients c
JOIN clients o ON o.phone = c.phone AND o.id != c.id
WHERE c.id = ? AND c.phone IS NOT NULL AND c.phone != ''
  AND o.business_id = c.business_id AND o.status = 'active' AND o.deleted_at IS NULL
ORDER BY o.name COLLATE NOCASE, o.id`;

/** "This number is shared with …" naming the client's active sharers, or null for none. */
function useSharedNumber(clientId: string): string | null {
    const names = useQuery<{ name: string }>(SHARED_NUMBER_SQL, [clientId]).data;
    return names.length === 0 ? null : m.sharedNumber(formatList(names.map((r) => r.name)));
}

// The client beside a thread: contact, subjects, what they owe and their next visit after `?`.
export const INBOX_CLIENT_SQL = `
SELECT c.id, c.name, c.phone,
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
    status: string;
    created_at: string;
    client_name: string | null;
    phone: string | null;
    last_message_at: string | null;
    unread_count: number;
    last_body: string | null;
    subject_names: string | null;
}

export interface InboxThread extends InboxRow {
    title: string;
    ago: string;
    subjects: string[];
    // The client or their number replied STOP: texts are blocked until the matching START.
    textsOff: boolean;
    // Why texts are off: the number's STOP, or the client's own.
    textsOffBody: string;
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

type InboxFilter = "all" | "unread";

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
];

export function quickReplies(): { key: string; label: string; text: string }[] {
    return m.quickReplyOptions.map((q, i) => ({ key: String(i), label: q.label, text: q.text }));
}

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
            textsOff: textsStopped(consents.map, t.client_id),
            textsOffBody: consents.stoppedByClient.has(t.client_id)
                ? m.textsOffBodyByClient
                : m.textsOffBody,
        }));
    }, [rows.data, consents.map, consents.stoppedByClient, zone]);
    const filtered = useMemo(() => {
        const term = q.trim().toLowerCase();
        return threads.filter(
            (t) =>
                (filter === "all" || t.unread_count > 0) &&
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
        unread: filtered.filter((t) => t.unread_count > 0).length,
    };
}

interface ConversationRow {
    id: string;
    direction: string;
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
    phone: string | null;
    subject_names: string | null;
    balance_cents: number | null;
    next_at: string | null;
    next_service: string | null;
}

export interface Conversation {
    days: { label: string; items: ThreadItem[] }[];
    // Other active clients on the same number, any of whom may have sent a reply.
    sharedWith: string | null;
    client: ClientContextRow | null;
    consent: MarketingConsent;
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
    // a thread opens with its first message, so one newer than this device's history is all here
    const reachesBack = parseTimestamp(thread.created_at) < historyStart(now);
    // a merge can move the thread's start earlier, which reopens the history to fetch
    const from = `${thread.id} ${thread.created_at}`;
    const [older, setOlder] = useState<{ from: string; rows: ConversationRow[]; more: boolean }>({
        from,
        rows: [],
        more: reachesBack,
    });
    const earlier = older.from === from ? older : { rows: [], more: reachesBack };
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
                    from,
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
    const sharedWith = useSharedNumber(thread.client_id);
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
        sharedWith,
        client,
        consent: consentFor(consents.map, thread.client_id),
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

export function consentDetail(c: MarketingConsent, zone: string): string | null {
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

export function consentLabel(c: MarketingConsent): { label: string; intent: Intent } {
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
    input: { client_id: string; body: string; booking_id?: string },
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
    body: string;
    setBody: (v: string) => void;
    busy: boolean;
    error: string | null;
    submit: () => void;
    segments: { chars: number; segments: number };
    // How many texts a long message will go out as; it still sends.
    segmentNote: string | null;
    smsBlocked: boolean;
    canSend: boolean;
}

export function useThreadComposer(api: ApiLike, thread: InboxThread): ThreadComposer {
    const [body, setBody] = useState("");
    const { busy, error, setError, run } = useAsyncAction();
    const attempt = useRef<Attempt | null>(null);
    const smsBlocked = thread.textsOff;
    const canSend = !smsBlocked && body.trim().length > 0;
    return {
        body,
        setBody,
        busy,
        error,
        submit: () => {
            if (!canSend) return;
            const tooLong = textLengthError(body);
            if (tooLong !== null) {
                setError(tooLong);
                return;
            }
            run(
                () => sendMessage(api, { client_id: thread.client_id, body: body.trim() }, attempt),
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
        segmentNote: segmentNote(body),
        smsBlocked,
        canSend,
    };
}

interface NewMessage {
    clients: SelectOption<string>[];
    clientId: string;
    setClientId: (id: string) => void;
    body: string;
    setBody: (v: string) => void;
    smsBlocked: boolean;
    segments: { chars: number; segments: number };
    segmentNote: string | null;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

export function useNewMessage(
    api: ApiLike,
    onSent: (sent: { clientId: string; name: string }) => void,
    initialClientId = "",
): NewMessage {
    const photos = usePeoplePhotos();
    const clients = useClients();
    const consents = useConsents();
    const [clientId, setClientIdRaw] = useState(initialClientId);
    const [body, setBody] = useState("");
    const { busy, error, setError, run } = useAsyncAction();
    const attempt = useRef<Attempt | null>(null);
    const smsBlocked = textsStopped(consents.map, clientId);
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
        },
        body,
        setBody,
        smsBlocked,
        segments: smsSegments(body),
        segmentNote: segmentNote(body),
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
            const tooLong = textLengthError(body);
            if (tooLong !== null) {
                setError(tooLong);
                return;
            }
            if (smsBlocked) return;
            const name = clients.find((c) => c.id === clientId)?.name ?? "";
            run(() => sendMessage(api, { client_id: clientId, body: body.trim() }, attempt), {
                onSuccess: () => {
                    attempt.current = null;
                    setBody("");
                    onSent({ clientId, name });
                },
                errorMessage: sendFailure,
            });
        },
    };
}

const SHARED_PHOTOS_SQL = `
SELECT COUNT(*) AS n FROM files
WHERE parent_type = 'booking' AND parent_id = ? AND uploaded_at IS NOT NULL
  AND shared_at IS NOT NULL`;

interface VisitNote {
    body: string;
    segmentNote: string | null;
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
    const sharedPhotos =
        useQuery<{ n: number }>(SHARED_PHOTOS_SQL, [bookingId ?? ""]).data[0]?.n ?? 0;
    const [body, setBody] = useState("");
    const [sent, setSent] = useState(false);
    const { busy, error, setError, run } = useAsyncAction();
    const attempt = useRef<Attempt | null>(null);
    return {
        body,
        segmentNote: segmentNote(body),
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
            const tooLong = textLengthError(body);
            if (tooLong !== null) {
                setError(tooLong);
                return;
            }
            run(
                () =>
                    sendMessage(
                        api,
                        { client_id: clientId, body: body.trim(), booking_id: bookingId },
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
