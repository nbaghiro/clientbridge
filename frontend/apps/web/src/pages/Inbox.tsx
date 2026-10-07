import {
    type BroadcastResult,
    type Channel,
    MESSAGE_CHANNELS,
    type MessageRow,
    type InboxSegmentKey,
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
    useMarkThreadRead,
    useThreadMessages,
    useThreads,
    visibleInboxSegments,
} from "@clientbridge/app-core";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
    Badge,
    Button,
    Choice,
    Empty,
    Field,
    Modal,
    Notice,
    PageHeader,
    Select,
    StatusPill,
    Tabs,
    TextField,
} from "@clientbridge/ui";

import { api } from "../lib/api";
import { useLinkIntent } from "../lib/links";
import { useRole } from "../lib/auth";
import { Contracts } from "./Contracts";
import { Forms } from "./Forms";
import { Reviews } from "./Reviews";

type Panel = "none" | "new" | "broadcast";

export function Inbox() {
    const segments = visibleInboxSegments(useRole());
    const [params, setParams] = useSearchParams();
    const segment: InboxSegmentKey =
        segments.find((x) => x.key === params.get("segment"))?.key ?? "messages";
    const setSegment = (key: InboxSegmentKey): void => {
        setParams(key === "messages" ? {} : { segment: key });
    };

    return (
        <div className="flex h-full flex-col">
            <header className="border-b border-line px-8 pt-6">
                <PageHeader title={strings.messaging.title}>
                    {segments.length > 1 ? (
                        <Tabs items={segments} active={segment} onSelect={setSegment} />
                    ) : (
                        <div className="h-1" />
                    )}
                </PageHeader>
            </header>
            {segment === "messages" ? (
                <Messages />
            ) : (
                <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
                    {segment === "reviews" ? (
                        <Reviews />
                    ) : segment === "forms" ? (
                        <Forms />
                    ) : (
                        <Contracts />
                    )}
                </div>
            )}
        </div>
    );
}

function Messages() {
    const threads = useThreads();
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [panel, setPanel] = useState<Panel>("none");
    const selected = threads.find((t) => t.id === selectedId) ?? null;
    useLinkIntent({
        onCreate: () => {
            setPanel("new");
        },
        onOpen: (clientId) => {
            const thread = threads.find((t) => t.client_id === clientId);
            if (thread === undefined) setPanel("new");
            else setSelectedId(thread.id);
        },
    });

    return (
        <div className="flex min-h-0 flex-1 flex-col px-8 py-6">
            <header className="flex items-center justify-between gap-4 pb-4">
                <p className="text-sm text-muted">{strings.messaging.subtitle}</p>
                <div className="flex shrink-0 gap-2">
                    <Button
                        variant="outline"
                        onPress={() => {
                            setPanel("broadcast");
                        }}
                    >
                        {strings.messaging.broadcast}
                    </Button>
                    <Button
                        onPress={() => {
                            setPanel("new");
                        }}
                    >
                        {strings.messaging.newMessage}
                    </Button>
                </div>
            </header>

            <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-surface shadow-card">
                <aside className="w-80 shrink-0 overflow-y-auto border-r border-line">
                    {threads.length === 0 ? (
                        <Empty message={strings.messaging.noConversations} />
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

                <section className="min-w-0 flex-1 overflow-y-auto bg-bg">
                    {selected !== null ? (
                        // Keyed by thread so the composer reseeds; otherwise a reply could go to the previous client.
                        <ThreadView key={selected.id} thread={selected} />
                    ) : (
                        <div className="flex h-full items-center justify-center">
                            <p className="text-sm text-muted">
                                {strings.messaging.selectConversation}
                            </p>
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
                    {thread.client_name ?? strings.messaging.clientFallback}
                </span>
                {thread.last_message_at !== null ? (
                    <span className="text-xs text-muted">
                        {formatRelativeTime(thread.last_message_at)}
                    </span>
                ) : null}
                {thread.unread_count > 0 ? (
                    <Badge variant="count" label={thread.unread_count} />
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

    useMarkThreadRead(api, thread);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ block: "end" });
    }, [messages.length]);

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b border-line px-6 py-3.5">
                <h2 className="font-display text-base font-bold text-ink">
                    {thread.client_name ?? strings.messaging.clientFallback}
                </h2>
                <StatusPill status={channelLabel(thread.channel)} intent="neutral" />
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto px-6 py-4">
                {messages.length === 0 ? (
                    <Empty message={strings.messaging.noMessages} />
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
                    <div className="mb-2">
                        <Notice tone="danger">{compose.error}</Notice>
                    </div>
                ) : null}
                <div className="flex items-end gap-2">
                    <div className="flex-1">
                        <TextField
                            multiline
                            rows={2}
                            value={compose.body}
                            onChange={compose.setBody}
                            placeholder={strings.messaging.replyBy(
                                channelLabel(thread.channel).toLowerCase(),
                            )}
                        />
                    </div>
                    <Button
                        submit
                        size="lg"
                        busy={compose.busy}
                        disabled={compose.body.trim().length === 0}
                    >
                        {compose.busy ? strings.messaging.sending : strings.messaging.send}
                    </Button>
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

function ChannelToggle({ value, onChange }: { value: Channel; onChange: (c: Channel) => void }) {
    return (
        <Field label={strings.messaging.channelLabel}>
            <Choice
                layout="segmented"
                options={MESSAGE_CHANNELS.map((ch) => ({ key: ch, label: channelLabel(ch) }))}
                value={value}
                onChange={onChange}
            />
        </Field>
    );
}

function NewMessageModal({ onClose }: { onClose: () => void }) {
    const compose = useComposeMessage(api, onClose);
    const clients = useClients();

    return (
        <Modal onClose={onClose}>
            <h2 className="mb-4 font-display text-lg font-bold text-ink">
                {strings.messaging.newMessageTitle}
            </h2>
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    compose.submit();
                }}
                className="space-y-3"
            >
                <Select
                    label={strings.messaging.clientLabel}
                    value={compose.clientId}
                    options={[
                        { key: "", label: strings.messaging.selectClient },
                        ...clients.map((cl) => ({ key: cl.id, label: cl.name })),
                    ]}
                    onChange={compose.setClientId}
                />
                <ChannelToggle value={compose.channel} onChange={compose.setChannel} />
                <TextField
                    label={strings.messaging.messageLabel}
                    multiline
                    rows={4}
                    value={compose.body}
                    onChange={compose.setBody}
                    placeholder={strings.messaging.messagePlaceholder}
                />
                {compose.error !== null ? <Notice tone="danger">{compose.error}</Notice> : null}
                <div className="flex justify-end gap-2 pt-1">
                    <Button variant="quiet" onPress={onClose}>
                        {strings.common.cancel}
                    </Button>
                    <Button submit busy={compose.busy}>
                        {compose.busy ? strings.messaging.sending : strings.messaging.sendMessage}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}

function BroadcastModal({ onClose }: { onClose: () => void }) {
    const [sent, setSent] = useState<BroadcastResult | null>(null);
    const form = useBroadcastForm(api, setSent);

    if (sent !== null) {
        return (
            <Modal onClose={onClose}>
                <div className="py-4 text-center">
                    <h2 className="font-display text-lg font-bold text-ink">
                        {sent.status === "scheduled"
                            ? strings.messaging.broadcastScheduled
                            : strings.messaging.broadcastSent}
                    </h2>
                    <p className="mt-2 text-sm text-muted">
                        {strings.messaging.broadcastRecipients(sent.name, sent.recipient_count)}
                    </p>
                    <div className="mt-5">
                        <Button onPress={onClose}>{strings.common.done}</Button>
                    </div>
                </div>
            </Modal>
        );
    }

    return (
        <Modal onClose={onClose}>
            <h2 className="mb-4 font-display text-lg font-bold text-ink">
                {strings.messaging.newBroadcastTitle}
            </h2>
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    form.submit();
                }}
                className="space-y-3"
            >
                <TextField
                    label={strings.messaging.nameLabel}
                    value={form.name}
                    onChange={form.setName}
                    placeholder={strings.messaging.namePlaceholder}
                />
                <ChannelToggle value={form.channel} onChange={form.setChannel} />
                <TextField
                    label={strings.messaging.messageLabel}
                    multiline
                    rows={4}
                    value={form.body}
                    onChange={form.setBody}
                    placeholder={strings.messaging.announcementPlaceholder}
                />
                <TextField
                    label={strings.messaging.audienceTagsLabel}
                    optional
                    value={form.tags}
                    onChange={form.setTags}
                    placeholder={strings.messaging.tagsPlaceholderWeb}
                />
                <TextField
                    label={strings.messaging.scheduleLabel}
                    optional
                    type="datetime-local"
                    value={form.scheduledAt}
                    onChange={form.setScheduledAt}
                />
                {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                <div className="flex justify-end gap-2 pt-1">
                    <Button variant="quiet" onPress={onClose}>
                        {strings.common.cancel}
                    </Button>
                    <Button submit busy={form.busy}>
                        {form.busy ? strings.messaging.sending : strings.messaging.sendBroadcast}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
