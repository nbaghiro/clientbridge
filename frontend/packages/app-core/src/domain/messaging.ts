import { useBusinessQuery as useQuery } from "../hooks";

import { useEffect, useMemo, useState } from "react";

import { type ApiLike, newIdempotencyKey } from "../api";
import {
    formatDate,
    formatRelativeTime,
    formatTime,
    formatWeekday,
    parseTimestamp,
    relativeDay,
    sameDay,
} from "../datetime";
import { formatPhone } from "../format";
import { type Load, useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { Intent } from "../ui";
import { type ChannelConsent, consentFor, smsSegments, useConsents } from "./broadcasts";
import { useClients } from "./clients";
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
           AS pet_names
FROM threads t
LEFT JOIN clients c ON c.id = t.client_id
ORDER BY last_message_at DESC`;

export const CONVERSATION_SQL = `
SELECT m.id, m.direction, m.channel, m.body, m.status, m.created_at, st.name AS author
FROM messages m LEFT JOIN staff st ON st.user_id = m.sent_by
WHERE m.thread_id = ? ORDER BY m.created_at`;

// The client beside a thread: contact, pets, what they owe and their next visit after `?`.
export const INBOX_CLIENT_SQL = `
SELECT c.id, c.name, c.email, c.phone,
       (SELECT GROUP_CONCAT(s.name, ', ') FROM subjects s WHERE s.client_id = c.id) AS pet_names,
       (SELECT SUM(a.balance_cents) FROM accounts a WHERE a.owner_type = 'client'
          AND a.owner_id = c.id AND a.category = 'receivable') AS balance_cents,
       (SELECT sl.starts_at FROM bookings b JOIN slots sl ON sl.id = b.slot_id
        WHERE b.client_id = c.id AND b.status IN ('pending', 'confirmed') AND sl.starts_at > ?
        ORDER BY sl.starts_at LIMIT 1) AS next_at,
       (SELECT i.name FROM bookings b JOIN slots sl ON sl.id = b.slot_id
        JOIN items i ON i.id = sl.item_id
        WHERE b.client_id = c.id AND b.status IN ('pending', 'confirmed') AND sl.starts_at > ?
        ORDER BY sl.starts_at LIMIT 1) AS next_service
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
    pet_names: string | null;
}

export interface InboxThread extends InboxRow {
    title: string;
    ago: string;
    pets: string[];
    // The client replied STOP: texts are blocked until they reply START.
    textsOff: boolean;
    channelKind: "sms" | "email" | "chat";
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
    { key: "all", label: m.filters.all },
    { key: "unread", label: m.filters.unread },
    { key: "sms", label: m.filters.sms },
    { key: "email", label: m.filters.email },
];

export function channelLabel(channel: string): string {
    if (channel === "sms") return m.channelSms;
    if (channel === "email") return m.channelEmail;
    if (channel === "chat") return m.channelChat;
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
    const [filter, setFilter] = useState<InboxFilter>("all");
    const [q, setQ] = useState("");
    const threads = useMemo(() => {
        const now = new Date();
        return rows.data.map((t) => ({
            ...t,
            title: t.client_name ?? formatPhone(t.phone),
            ago: t.last_message_at === null ? "" : formatRelativeTime(t.last_message_at, now),
            pets: t.pet_names === null ? [] : t.pet_names.split(", "),
            textsOff: stopped(consentFor(consents.map, t.client_id, "sms")),
            channelKind:
                t.channel === "email"
                    ? ("email" as const)
                    : t.channel === "chat"
                      ? ("chat" as const)
                      : ("sms" as const),
        }));
    }, [rows.data, consents.map]);
    const filtered = useMemo(() => {
        const term = q.trim().toLowerCase();
        return threads.filter(
            (t) =>
                (filter === "all" ||
                    (filter === "unread" && t.unread_count > 0) ||
                    t.channel === filter) &&
                (term === "" ||
                    [t.title, t.last_body ?? "", ...t.pets].some((v) =>
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
    pet_names: string | null;
    balance_cents: number | null;
    next_at: string | null;
    next_service: string | null;
}

export interface Conversation {
    days: { label: string; items: ThreadItem[] }[];
    client: ClientContextRow | null;
    consent: Record<Channel, ChannelConsent>;
    nextVisit: string | null;
}

const MESSAGE_STATUS: Record<string, string> = {
    delivered: m.thread.status.delivered,
    sent: m.thread.status.sent,
    read: m.thread.status.delivered,
    failed: m.thread.status.failed,
    queued: m.thread.status.queued,
};

/** "Today 2:30 p.m." or "Fri 9:00 a.m." for a visit in the coming week, else the date. */
function visitWhen(d: Date, now: Date): string {
    const time = formatTime(d);
    if (sameDay(d, now)) return `${strings.common.today} ${time}`;
    return d.getTime() - now.getTime() < 6 * 86_400_000
        ? `${formatWeekday(d)} ${time}`
        : `${formatDate(d)}, ${time}`;
}

/** Messages grouped by day; outbound ones carry who sent them, or Automatic for the system. */
export function useConversation(thread: InboxThread): Conversation {
    const now = useMemo(() => new Date(), []);
    const iso = now.toISOString();
    const rows = useQuery<ConversationRow>(CONVERSATION_SQL, [thread.id]).data;
    const client =
        useQuery<ClientContextRow>(INBOX_CLIENT_SQL, [iso, iso, thread.client_id]).data[0] ?? null;
    const consents = useConsents();
    const days = useMemo(() => {
        const out: Conversation["days"] = [];
        for (const r of rows) {
            const d = parseTimestamp(r.created_at);
            const label = relativeDay(d, "long");
            const author = r.author === null ? m.thread.automatic : r.author.split(" ")[0];
            const meta =
                r.direction === "out"
                    ? [formatTime(d), author, MESSAGE_STATUS[r.status] ?? null]
                          .filter((v) => v !== null && v !== undefined)
                          .join(" · ")
                    : formatTime(d);
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
    }, [rows]);
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
                : [client.next_service, visitWhen(parseTimestamp(client.next_at), now)]
                      .filter((v) => v !== null)
                      .join(" · "),
    };
}

export function consentDetail(c: ChannelConsent): string | null {
    const b = strings.broadcasts;
    if (c.state === "implied" && c.expiresAt !== null)
        return m.consentImpliedUntil(formatDate(parseTimestamp(c.expiresAt)));
    if (c.source !== null && c.at !== null)
        return b.consentSource(b.sources[c.source] ?? c.source, formatDate(parseTimestamp(c.at)));
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

function sendMessage(
    api: ApiLike,
    input: { client_id: string; channel: Channel; body: string },
): Promise<unknown> {
    return api.post("/v1/messages", input, { idempotencyKey: newIdempotencyKey() });
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
                    sendMessage(api, {
                        client_id: thread.client_id,
                        channel,
                        body: body.trim(),
                    }),
                {
                    onSuccess: () => {
                        setBody("");
                    },
                    errorMessage: m.sendError,
                },
            );
        },
        segments: smsSegments(body),
        smsBlocked,
        canSend,
    };
}

interface NewMessage {
    clients: { key: string; label: string }[];
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
    const clients = useClients();
    const consents = useConsents();
    const [clientId, setClientIdRaw] = useState(initialClientId);
    const [channel, setChannel] = useState<Channel>("sms");
    const [body, setBody] = useState("");
    const { busy, error, setError, run } = useAsyncAction();
    const sms = consentFor(consents.map, clientId, "sms");
    const smsBlocked = channel === "sms" && stopped(sms);
    return {
        clients: clients.map((c) => ({ key: c.id, label: c.name })),
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
            run(() => sendMessage(api, { client_id: clientId, channel, body: body.trim() }), {
                onSuccess: () => {
                    setBody("");
                    onSent({ clientId, name });
                },
                errorMessage: m.sendError,
            });
        },
    };
}
