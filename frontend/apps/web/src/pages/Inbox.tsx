import {
    type BroadcastResult,
    type Channel,
    MESSAGE_CHANNELS,
    type MessageRow,
    type ThreadRow,
    channelLabel,
    formatRelativeTime,
    formatTime,
    messageStatusIntent,
    parseTimestamp,
    strings,
    useBroadcastForm,
    useClients,
    useComposeMessage,
    useThreadMessages,
    useThreads,
    markThreadRead,
} from "@clientbridge/app-core";
import { useEffect, useRef, useState } from "react";

import { StatusPill } from "../components/StatusPill";
import { api } from "../lib/api";

const field =
    "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-accent";

type Panel = "none" | "new" | "broadcast";

export function Inbox() {
    const threads = useThreads();
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [panel, setPanel] = useState<Panel>("none");
    const selected = threads.find((t) => t.id === selectedId) ?? null;

    return (
        <div className="flex h-full flex-col">
            <header className="flex items-center justify-between gap-4 border-b border-line px-8 py-5">
                <div>
                    <h1 className="font-display text-2xl font-bold text-ink">
                        {strings.inbox.title}
                    </h1>
                    <p className="mt-0.5 text-sm text-muted">{strings.inbox.subtitle}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                    <button
                        type="button"
                        onClick={() => {
                            setPanel("broadcast");
                        }}
                        className="rounded-md border border-line px-3.5 py-2 text-sm font-semibold text-ink-soft transition hover:bg-bg"
                    >
                        {strings.inbox.broadcast}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setPanel("new");
                        }}
                        className="rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90"
                    >
                        {strings.inbox.newMessage}
                    </button>
                </div>
            </header>

            <div className="flex min-h-0 flex-1">
                <aside className="w-80 shrink-0 overflow-y-auto border-r border-line">
                    {threads.length === 0 ? (
                        <p className="px-5 py-8 text-center text-sm text-muted">
                            {strings.inbox.noConversations}
                        </p>
                    ) : (
                        threads.map((t) => (
                            <ThreadListItem
                                key={t.id}
                                thread={t}
                                active={t.id === selectedId}
                                onSelect={() => {
                                    setSelectedId(t.id);
                                }}
                            />
                        ))
                    )}
                </aside>

                <section className="min-w-0 flex-1 overflow-y-auto">
                    {selected !== null ? (
                        <ThreadView thread={selected} />
                    ) : (
                        <div className="flex h-full items-center justify-center">
                            <p className="text-sm text-muted">{strings.inbox.selectConversation}</p>
                        </div>
                    )}
                </section>
            </div>

            {panel === "new" ? (
                <NewMessageModal
                    onClose={() => {
                        setPanel("none");
                    }}
                />
            ) : null}
            {panel === "broadcast" ? (
                <BroadcastModal
                    onClose={() => {
                        setPanel("none");
                    }}
                />
            ) : null}
        </div>
    );
}

function ThreadListItem({
    thread,
    active,
    onSelect,
}: {
    thread: ThreadRow;
    active: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className={`flex w-full flex-col gap-1 border-b border-line px-5 py-3 text-left transition ${
                active ? "bg-accent-weak" : "hover:bg-bg"
            }`}
        >
            <div className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm font-semibold text-ink">
                    {thread.client_name ?? strings.inbox.clientFallback}
                </span>
                {thread.last_message_at !== null ? (
                    <span className="text-xs text-muted">
                        {formatRelativeTime(thread.last_message_at)}
                    </span>
                ) : null}
                {thread.unread_count > 0 ? (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-ink">
                        {thread.unread_count}
                    </span>
                ) : null}
            </div>
            <span className="truncate text-xs text-muted">
                {channelLabel(thread.channel)}
                {thread.last_body !== null ? ` · ${thread.last_body}` : ""}
            </span>
        </button>
    );
}

function ThreadView({ thread }: { thread: ThreadRow }) {
    const messages = useThreadMessages(thread.id);
    const compose = useComposeMessage(api, () => undefined, {
        clientId: thread.client_id,
        channel: thread.channel as Channel,
    });
    const bottomRef = useRef<HTMLDivElement>(null);

    // Mark read once on open (and whenever the unread count changes for the open thread).
    useEffect(() => {
        if (thread.unread_count > 0) void markThreadRead(api, thread.id);
    }, [thread.id, thread.unread_count]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ block: "end" });
    }, [messages.length]);

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b border-line px-6 py-3.5">
                <h2 className="font-display text-base font-bold text-ink">
                    {thread.client_name ?? strings.inbox.clientFallback}
                </h2>
                <StatusPill status={channelLabel(thread.channel)} intent="neutral" />
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto px-6 py-4">
                {messages.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted">
                        {strings.inbox.noMessages}
                    </p>
                ) : (
                    messages.map((m) => <Bubble key={m.id} message={m} />)
                )}
                <div ref={bottomRef} />
            </div>

            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    compose.submit();
                }}
                className="border-t border-line px-6 py-3"
            >
                {compose.error !== null ? (
                    <p className="mb-2 text-sm text-danger">{compose.error}</p>
                ) : null}
                <div className="flex items-end gap-2">
                    <textarea
                        value={compose.body}
                        onChange={(e) => {
                            compose.setBody(e.target.value);
                        }}
                        rows={2}
                        placeholder={strings.inbox.replyBy(
                            channelLabel(thread.channel).toLowerCase(),
                        )}
                        className={`${field} resize-none`}
                    />
                    <button
                        type="submit"
                        disabled={compose.busy || compose.body.trim().length === 0}
                        className="rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                    >
                        {compose.busy ? strings.inbox.sending : strings.inbox.send}
                    </button>
                </div>
            </form>
        </div>
    );
}

function Bubble({ message }: { message: MessageRow }) {
    const outbound = message.direction === "out";
    return (
        <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
            <div className="max-w-[75%]">
                <div
                    className={`rounded-2xl px-3.5 py-2 text-sm ${
                        outbound
                            ? "bg-accent text-accent-ink"
                            : "border border-line bg-surface text-ink"
                    }`}
                >
                    {message.body ?? ""}
                </div>
                <div
                    className={`mt-1 flex items-center gap-1.5 text-[11px] text-muted ${
                        outbound ? "justify-end" : "justify-start"
                    }`}
                >
                    <span>{formatTime(parseTimestamp(message.created_at))}</span>
                    {outbound ? (
                        <StatusPill
                            status={message.status}
                            intent={messageStatusIntent(message.status)}
                        />
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function ModalFrame({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
    return (
        <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-6"
            onClick={onClose}
        >
            <div
                className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-card"
                onClick={(e) => {
                    e.stopPropagation();
                }}
            >
                {children}
            </div>
        </div>
    );
}

function ChannelToggle({ value, onChange }: { value: Channel; onChange: (c: Channel) => void }) {
    return (
        <div className="flex gap-2">
            {MESSAGE_CHANNELS.map((ch) => (
                <button
                    key={ch}
                    type="button"
                    onClick={() => {
                        onChange(ch);
                    }}
                    className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
                        value === ch
                            ? "border-accent bg-accent-weak text-accent-strong"
                            : "border-line text-ink-soft hover:bg-bg"
                    }`}
                >
                    {channelLabel(ch)}
                </button>
            ))}
        </div>
    );
}

function NewMessageModal({ onClose }: { onClose: () => void }) {
    const compose = useComposeMessage(api, onClose);
    const clients = useClients();

    return (
        <ModalFrame onClose={onClose}>
            <h2 className="mb-4 font-display text-lg font-bold text-ink">
                {strings.inbox.newMessageTitle}
            </h2>
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    compose.submit();
                }}
                className="space-y-3"
            >
                <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                    {strings.inbox.clientLabel}
                    <select
                        value={compose.clientId}
                        onChange={(e) => {
                            compose.setClientId(e.target.value);
                        }}
                        className={field}
                    >
                        <option value="">{strings.inbox.selectClient}</option>
                        {clients.map((cl) => (
                            <option key={cl.id} value={cl.id}>
                                {cl.name}
                            </option>
                        ))}
                    </select>
                </label>
                <div className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                    {strings.inbox.channelLabel}
                    <ChannelToggle value={compose.channel} onChange={compose.setChannel} />
                </div>
                <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                    {strings.inbox.messageLabel}
                    <textarea
                        value={compose.body}
                        onChange={(e) => {
                            compose.setBody(e.target.value);
                        }}
                        rows={4}
                        placeholder={strings.inbox.messagePlaceholder}
                        className={`${field} resize-none`}
                    />
                </label>
                {compose.error !== null ? (
                    <p className="text-sm text-danger">{compose.error}</p>
                ) : null}
                <div className="flex justify-end gap-2 pt-1">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-bg"
                    >
                        {strings.common.cancel}
                    </button>
                    <button
                        type="submit"
                        disabled={compose.busy}
                        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                    >
                        {compose.busy ? strings.inbox.sending : strings.inbox.sendMessage}
                    </button>
                </div>
            </form>
        </ModalFrame>
    );
}

function BroadcastModal({ onClose }: { onClose: () => void }) {
    const [sent, setSent] = useState<BroadcastResult | null>(null);
    const form = useBroadcastForm(api, setSent);

    if (sent !== null) {
        return (
            <ModalFrame onClose={onClose}>
                <div className="py-4 text-center">
                    <h2 className="font-display text-lg font-bold text-ink">
                        {sent.status === "scheduled"
                            ? strings.inbox.broadcastScheduled
                            : strings.inbox.broadcastSent}
                    </h2>
                    <p className="mt-2 text-sm text-muted">
                        {strings.inbox.broadcastRecipients(sent.name, sent.recipient_count)}
                    </p>
                    <button
                        type="button"
                        onClick={onClose}
                        className="mt-5 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90"
                    >
                        {strings.common.done}
                    </button>
                </div>
            </ModalFrame>
        );
    }

    return (
        <ModalFrame onClose={onClose}>
            <h2 className="mb-4 font-display text-lg font-bold text-ink">
                {strings.inbox.newBroadcastTitle}
            </h2>
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    form.submit();
                }}
                className="space-y-3"
            >
                <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                    {strings.inbox.nameLabel}
                    <input
                        value={form.name}
                        onChange={(e) => {
                            form.setName(e.target.value);
                        }}
                        placeholder={strings.inbox.namePlaceholder}
                        className={field}
                    />
                </label>
                <div className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                    {strings.inbox.channelLabel}
                    <ChannelToggle value={form.channel} onChange={form.setChannel} />
                </div>
                <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                    {strings.inbox.messageLabel}
                    <textarea
                        value={form.body}
                        onChange={(e) => {
                            form.setBody(e.target.value);
                        }}
                        rows={4}
                        placeholder={strings.inbox.announcementPlaceholder}
                        className={`${field} resize-none`}
                    />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                    {strings.inbox.audienceTagsLabel}{" "}
                    <span className="font-normal text-muted">{strings.inbox.optional}</span>
                    <input
                        value={form.tags}
                        onChange={(e) => {
                            form.setTags(e.target.value);
                        }}
                        placeholder={strings.inbox.tagsPlaceholderWeb}
                        className={field}
                    />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                    {strings.inbox.scheduleLabel}{" "}
                    <span className="font-normal text-muted">{strings.inbox.optional}</span>
                    <input
                        type="datetime-local"
                        value={form.scheduledAt}
                        onChange={(e) => {
                            form.setScheduledAt(e.target.value);
                        }}
                        className={field}
                    />
                </label>
                {form.error !== null ? <p className="text-sm text-danger">{form.error}</p> : null}
                <div className="flex justify-end gap-2 pt-1">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-bg"
                    >
                        {strings.common.cancel}
                    </button>
                    <button
                        type="submit"
                        disabled={form.busy}
                        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                    >
                        {form.busy ? strings.inbox.sending : strings.inbox.sendBroadcast}
                    </button>
                </div>
            </form>
        </ModalFrame>
    );
}
