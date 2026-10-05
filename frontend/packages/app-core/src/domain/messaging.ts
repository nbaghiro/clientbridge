import { useQuery } from "@powersync/react";
import { useEffect, useState } from "react";

import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import { type ApiLike, newIdempotencyKey } from "../api";
import type { Intent } from "../ui";

export type Channel = "sms" | "email";

/** The channels a message/broadcast can go out on. */
export const MESSAGE_CHANNELS: Channel[] = ["sms", "email"];

export interface ThreadRow {
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

export interface MessageRow {
    id: string;
    thread_id: string;
    direction: string;
    channel: string;
    body: string | null;
    status: string;
    created_at: string;
}

export const THREAD_MESSAGES_SQL = `
SELECT id, thread_id, direction, channel, body, status, created_at
FROM messages WHERE thread_id = ? ORDER BY created_at`;

/** A thread's messages oldest-first. Pass `""` (no selection) to get an empty result. */
export function useThreadMessages(threadId: string): MessageRow[] {
    return useQuery<MessageRow>(THREAD_MESSAGES_SQL, [threadId]).data;
}

export function channelLabel(channel: string): string {
    switch (channel) {
        case "sms":
            return strings.messaging.channelSms;
        case "email":
            return strings.messaging.channelEmail;
        case "chat":
            return strings.messaging.channelChat;
        default:
            return channel;
    }
}

export function messageStatusIntent(status: string): Intent {
    switch (status) {
        case "delivered":
        case "read":
        case "sent":
            return "success";
        case "failed":
            return "danger";
        case "queued":
        case "draft":
            return "neutral";
        default:
            return "neutral";
    }
}

export interface MessageResult {
    id: string;
    thread_id: string;
    direction: string;
    channel: string;
    body: string | null;
    status: string;
}

export function sendMessage(
    api: ApiLike,
    input: { client_id: string; channel: Channel; body: string },
): Promise<MessageResult> {
    return api.post<MessageResult>(
        "/v1/messages",
        { client_id: input.client_id, channel: input.channel, body: input.body },
        { idempotencyKey: newIdempotencyKey() },
    );
}

export interface ThreadResult {
    id: string;
    unread_count: number;
    status: string;
}

export function markThreadRead(api: ApiLike, threadId: string): Promise<ThreadResult> {
    return api.post<ThreadResult>(`/v1/threads/${threadId}/read`, {});
}

/** Marks the open thread read on open, and again whenever new inbound messages arrive while it is open. */
export function useMarkThreadRead(
    api: ApiLike,
    thread: { id: string; unread_count: number },
): void {
    useEffect(() => {
        if (thread.unread_count > 0) markThreadRead(api, thread.id).catch(() => undefined);
    }, [api, thread.id, thread.unread_count]);
}

export interface BroadcastResult {
    id: string;
    name: string;
    channel: string;
    status: string;
    recipient_count: number;
}

export interface BroadcastInput {
    name: string;
    channel: Channel;
    body: string;
    audience?: Record<string, unknown>;
    scheduled_at?: string | null;
}

export function sendBroadcast(api: ApiLike, input: BroadcastInput): Promise<BroadcastResult> {
    return api.post<BroadcastResult>(
        "/v1/broadcasts",
        {
            name: input.name,
            channel: input.channel,
            body: input.body,
            audience: input.audience ?? {},
            scheduled_at: input.scheduled_at ?? null,
        },
        { idempotencyKey: newIdempotencyKey() },
    );
}

export interface ComposeMessage {
    clientId: string;
    setClientId: (v: string) => void;
    channel: Channel;
    setChannel: (v: Channel) => void;
    body: string;
    setBody: (v: string) => void;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** The client clears on success only when `initial` did not fix it. */
export function useComposeMessage(
    api: ApiLike,
    onSent: () => void,
    initial?: { clientId?: string; channel?: Channel },
): ComposeMessage {
    const [clientId, setClientId] = useState(initial?.clientId ?? "");
    const [channel, setChannel] = useState<Channel>(initial?.channel ?? "sms");
    const [body, setBody] = useState("");
    const { busy, error, setError, run } = useAsyncAction();

    const submit = (): void => {
        if (clientId === "") {
            setError(strings.messaging.selectClient);
            return;
        }
        if (body.trim().length === 0) {
            setError(strings.messaging.writeMessage);
            return;
        }
        run(() => sendMessage(api, { client_id: clientId, channel, body: body.trim() }), {
            onSuccess: () => {
                setBody("");
                if (initial?.clientId === undefined) setClientId("");
                onSent();
            },
            errorMessage: strings.messaging.sendError,
        });
    };

    return { clientId, setClientId, channel, setChannel, body, setBody, busy, error, submit };
}

export interface BroadcastForm {
    name: string;
    setName: (v: string) => void;
    channel: Channel;
    setChannel: (v: Channel) => void;
    body: string;
    setBody: (v: string) => void;
    tags: string;
    setTags: (v: string) => void;
    scheduledAt: string;
    setScheduledAt: (v: string) => void;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

function parseTags(raw: string): string[] {
    return raw
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
}

/** No tags sends to everyone; a local datetime is sent as ISO for a scheduled send. */
export function useBroadcastForm(
    api: ApiLike,
    onSent: (result: BroadcastResult) => void,
): BroadcastForm {
    const [name, setName] = useState("");
    const [channel, setChannel] = useState<Channel>("sms");
    const [body, setBody] = useState("");
    const [tags, setTags] = useState("");
    const [scheduledAt, setScheduledAt] = useState("");
    const { busy, error, setError, run } = useAsyncAction();

    const submit = (): void => {
        if (name.trim().length === 0) {
            setError(strings.messaging.nameBroadcast);
            return;
        }
        if (body.trim().length === 0) {
            setError(strings.messaging.writeMessage);
            return;
        }
        const tagList = parseTags(tags);
        const audience: Record<string, unknown> =
            tagList.length > 0 ? { tags: tagList } : { all: true };
        const scheduled =
            scheduledAt.trim().length > 0 ? new Date(scheduledAt).toISOString() : null;
        run(
            async () => {
                const result = await sendBroadcast(api, {
                    name: name.trim(),
                    channel,
                    body: body.trim(),
                    audience,
                    scheduled_at: scheduled,
                });
                onSent(result);
            },
            {
                onSuccess: () => {
                    setName("");
                    setBody("");
                    setTags("");
                    setScheduledAt("");
                },
                errorMessage: strings.messaging.broadcastError,
            },
        );
    };

    return {
        name,
        setName,
        channel,
        setChannel,
        body,
        setBody,
        tags,
        setTags,
        scheduledAt,
        setScheduledAt,
        busy,
        error,
        submit,
    };
}
