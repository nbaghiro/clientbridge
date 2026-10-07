import {
    type Channel,
    type Conversation,
    INBOX_FILTERS,
    type InboxSegmentKey,
    type InboxThread,
    type ThreadComposer,
    channelLabel,
    consentDetail,
    consentLabel,
    formatPhone,
    strings,
    useConversation,
    useInbox,
    useMarkThreadRead,
    useNewMessage,
    useThreadComposer,
    visibleInboxSegments,
} from "@clientbridge/app-core";
import {
    Avatar,
    Badge,
    Button,
    Choice,
    ConversationRow,
    DetailView,
    Empty,
    KeyValueList,
    MessageBubble,
    Modal,
    Money,
    Notice,
    PageHeader,
    SearchField,
    Select,
    Tabs,
    TextField,
} from "@clientbridge/ui";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Loaded } from "../components/Loaded";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";
import { useLinkIntent, useOpenLink } from "../lib/links";
import { Broadcasts } from "./Broadcasts";
import { Contracts } from "./Contracts";
import { Forms } from "./Forms";
import { Reviews } from "./Reviews";

const s = strings.messaging;
const CHANNELS: Channel[] = ["sms", "email"];
const QUICK = s.quickReplyOptions.map((q, i) => ({ key: String(i), label: q.label, text: q.text }));

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
                <PageHeader title={s.title}>
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
                    ) : segment === "broadcasts" ? (
                        <Broadcasts />
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

const rowFlag = (t: InboxThread): { label: string; intent: "danger" } | undefined =>
    t.textsOff ? { label: s.textsOffShort, intent: "danger" } : undefined;

function Messages() {
    const inbox = useInbox();
    const [picked, setPicked] = useState<string | null>(null);
    const [details, setDetails] = useState(false);
    const [composing, setComposing] = useState<string | null>(null);
    const [sentTo, setSentTo] = useState<string | null>(null);
    const open = inbox.threads.find((t) => t.id === picked) ?? null;
    useLinkIntent({
        onCreate: () => {
            setComposing("");
        },
        onOpen: (clientId) => {
            const thread = inbox.threads.find((t) => t.client_id === clientId);
            if (thread === undefined) setComposing(clientId);
            else setPicked(thread.id);
        },
    });

    return (
        <div className="flex min-h-0 flex-1">
            <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-surface">
                <header className="space-y-3 border-b border-line px-4 pb-3 pt-4">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-muted">{s.unreadCount(inbox.unread)}</p>
                        <Button
                            size="sm"
                            icon="edit"
                            onPress={() => {
                                setSentTo(null);
                                setComposing("");
                            }}
                        >
                            {s.newShort}
                        </Button>
                    </div>
                    <SearchField
                        value={inbox.q}
                        onChange={inbox.setQ}
                        placeholder={s.searchPlaceholder}
                    />
                    <Choice
                        label={s.filterLabel}
                        options={INBOX_FILTERS}
                        value={inbox.filter}
                        onChange={inbox.setFilter}
                    />
                </header>
                <nav aria-label={s.title} className="flex-1 overflow-y-auto">
                    {sentTo !== null ? (
                        <div className="p-3">
                            <Notice tone="success">{s.sentNew(sentTo)}</Notice>
                        </div>
                    ) : null}
                    <Loaded load={inbox.load} loading={s.loading} failed={s.loadError} rows={6}>
                        {inbox.filtered.length === 0 ? (
                            <Empty
                                message={
                                    inbox.threads.length === 0 ? s.noThreads : s.noThreadsFiltered
                                }
                            />
                        ) : (
                            inbox.filtered.map((t) => (
                                <ConversationRow
                                    key={t.id}
                                    name={t.title}
                                    preview={t.last_body ?? ""}
                                    at={t.ago}
                                    unread={t.unread_count}
                                    channel={t.channelKind}
                                    channelLabel={channelLabel(t.channel)}
                                    selected={t.id === picked}
                                    tag={rowFlag(t)}
                                    onPress={() => {
                                        setPicked(t.id);
                                    }}
                                />
                            ))
                        )}
                    </Loaded>
                </nav>
            </aside>
            {open !== null ? (
                <Thread key={open.id} thread={open} details={details} onDetails={setDetails} />
            ) : (
                <section className="flex flex-1 items-center justify-center bg-bg">
                    {inbox.load.hasData ? (
                        <Empty
                            message={inbox.threads.length === 0 ? s.noThreads : s.selectThread}
                        />
                    ) : null}
                </section>
            )}
            {composing !== null ? (
                <NewMessageDialog
                    clientId={composing}
                    onClose={() => {
                        setComposing(null);
                    }}
                    onSent={(sent) => {
                        setComposing(null);
                        const thread = inbox.threads.find((t) => t.client_id === sent.clientId);
                        if (thread === undefined) setSentTo(sent.name);
                        else setPicked(thread.id);
                    }}
                />
            ) : null}
        </div>
    );
}

function Thread({
    thread,
    details,
    onDetails,
}: {
    thread: InboxThread;
    details: boolean;
    onDetails: (v: boolean) => void;
}) {
    const conversation = useConversation(thread);
    const composer = useThreadComposer(api, thread);
    useMarkThreadRead(api, thread);
    const end = useRef<HTMLDivElement>(null);
    const count = conversation.days.reduce((n, d) => n + d.items.length, 0);
    useEffect(() => {
        end.current?.scrollIntoView({ block: "end" });
    }, [count, thread.id]);
    const contact = thread.channel === "email" ? thread.email : formatPhone(thread.phone);

    return (
        <>
            <section className="flex min-w-0 flex-1 flex-col bg-bg">
                <div className="flex items-center gap-3 border-b border-line bg-surface px-5 py-3">
                    <Avatar name={thread.title} />
                    <div className="min-w-0 flex-1">
                        <h2 className="truncate font-display text-base font-bold text-ink">
                            {thread.title}
                        </h2>
                        <p className="truncate text-xs text-muted">
                            {[channelLabel(thread.channel), contact]
                                .filter((v) => v !== null && v !== "")
                                .join(" · ")}
                        </p>
                    </div>
                    <span className="xl:hidden">
                        <Button
                            size="sm"
                            variant="outline"
                            onPress={() => {
                                onDetails(true);
                            }}
                        >
                            {s.details}
                        </Button>
                    </span>
                </div>
                {thread.textsOff ? (
                    <div className="mx-5 mt-4">
                        <Notice tone="danger" banner>
                            <span className="font-semibold">
                                {s.textsOffTitle(thread.title.split(" ")[0] ?? "")}
                            </span>{" "}
                            {s.textsOffBody}
                        </Notice>
                    </div>
                ) : null}
                <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4" aria-live="polite">
                    {conversation.days.map((day) => (
                        <div key={day.label} className="space-y-3">
                            <div className="flex items-center gap-3 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                                <span className="h-px flex-1 bg-line" />
                                {day.label}
                                <span className="h-px flex-1 bg-line" />
                            </div>
                            {day.items.map((item) => (
                                <MessageBubble
                                    key={item.id}
                                    body={item.body}
                                    direction={item.direction}
                                    meta={item.meta}
                                    failed={item.failed}
                                />
                            ))}
                        </div>
                    ))}
                    <div ref={end} />
                </div>
                <Composer composer={composer} />
            </section>
            <aside
                aria-label={s.details}
                className="hidden w-[300px] shrink-0 overflow-y-auto border-l border-line bg-surface xl:block"
            >
                <ContextPanel thread={thread} conversation={conversation} />
            </aside>
            <DetailView
                open={details}
                title={thread.title}
                onClose={() => {
                    onDetails(false);
                }}
            >
                <ContextPanel thread={thread} conversation={conversation} />
            </DetailView>
        </>
    );
}

function Composer({ composer }: { composer: ThreadComposer }) {
    return (
        <div className="space-y-2.5 border-t border-line bg-surface px-5 py-3">
            <Choice
                label={s.quickReplies}
                options={QUICK}
                value={null}
                onChange={(k) => {
                    composer.setBody(QUICK.find((q) => q.key === k)?.text ?? "");
                }}
            />
            <TextField
                multiline
                rows={2}
                name={s.replyPlaceholder(channelLabel(composer.channel))}
                value={composer.body}
                onChange={composer.setBody}
                placeholder={s.replyPlaceholder(channelLabel(composer.channel))}
                disabled={composer.smsBlocked}
            />
            {composer.error !== null ? <Notice tone="danger">{composer.error}</Notice> : null}
            <div className="flex flex-wrap items-center gap-3">
                <Choice
                    layout="segmented"
                    label={s.channelLabel}
                    options={CHANNELS.map((c) => ({ key: c, label: s.channels[c] }))}
                    value={composer.channel}
                    onChange={composer.setChannel}
                />
                {composer.channel === "sms" && composer.body.length > 0 ? (
                    <span className="text-xs text-muted">
                        {s.smsCount(composer.segments.chars, composer.segments.segments)}
                    </span>
                ) : null}
                <span className="ml-auto">
                    <Button
                        icon="send"
                        busy={composer.busy}
                        disabled={!composer.canSend}
                        onPress={composer.submit}
                    >
                        {composer.busy ? s.sending : s.send}
                    </Button>
                </span>
            </div>
        </div>
    );
}

function ContextPanel({
    thread,
    conversation,
}: {
    thread: InboxThread;
    conversation: Conversation;
}) {
    const openLink = useOpenLink();
    const client = conversation.client;
    const balance = client?.balance_cents ?? 0;
    return (
        <div className="space-y-5 p-5">
            <div className="flex items-center gap-3">
                <Avatar name={thread.title} size="lg" />
                <div className="min-w-0">
                    <p className="truncate font-display text-base font-bold text-ink">
                        {thread.title}
                    </p>
                    <p className="truncate text-xs text-muted">{client?.email}</p>
                </div>
            </div>
            <div className="flex gap-2">
                <Button
                    size="sm"
                    grow
                    onPress={() => {
                        openLink("booking");
                    }}
                >
                    {s.book}
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    grow
                    onPress={() => {
                        openLink("client", thread.client_id);
                    }}
                >
                    {s.openRecord}
                </Button>
            </div>
            <KeyValueList
                rows={[
                    { label: s.pets, value: client?.pet_names ?? "—" },
                    {
                        label: s.balance,
                        value: balance > 0 ? <Money cents={balance} /> : s.settled,
                        intent: balance > 0 ? "warning" : undefined,
                    },
                    { label: s.nextVisit, value: conversation.nextVisit ?? s.nothingBooked },
                ]}
            />
            <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    {s.consentTitle}
                </h3>
                <ul className="divide-y divide-line-soft rounded-md border border-line">
                    {CHANNELS.map((ch) => {
                        const v = conversation.consent[ch];
                        const state = consentLabel(v);
                        const detail = consentDetail(v);
                        return (
                            <li
                                key={ch}
                                className="flex items-start justify-between gap-3 px-3 py-2.5"
                            >
                                <div className="min-w-0">
                                    <div className="text-sm font-medium text-ink">
                                        {s.consentChannel[ch]}
                                    </div>
                                    {detail !== null ? (
                                        <div className="text-xs text-muted">{detail}</div>
                                    ) : null}
                                </div>
                                <span className="shrink-0">
                                    <Badge label={state.label} intent={state.intent} />
                                </span>
                            </li>
                        );
                    })}
                </ul>
            </section>
        </div>
    );
}

function NewMessageDialog({
    clientId,
    onClose,
    onSent,
}: {
    clientId: string;
    onClose: () => void;
    onSent: (sent: { clientId: string; name: string }) => void;
}) {
    const msg = useNewMessage(api, onSent, clientId);
    return (
        <Modal open onClose={onClose}>
            <h2 className="mb-4 font-display text-lg font-bold text-ink">{s.newMessageTitle}</h2>
            <div className="space-y-3">
                <Select
                    label={s.clientLabel}
                    value={msg.clientId}
                    options={[{ key: "", label: s.chooseClient }, ...msg.clients]}
                    onChange={msg.setClientId}
                />
                <Choice
                    layout="segmented"
                    label={s.channelLabel}
                    options={CHANNELS.map((c) => ({ key: c, label: s.channels[c] }))}
                    value={msg.channel}
                    onChange={msg.setChannel}
                />
                {msg.smsBlocked ? <Notice tone="danger">{s.smsBlockedNew}</Notice> : null}
                <TextField
                    label={s.newMessageTitle}
                    multiline
                    rows={4}
                    value={msg.body}
                    onChange={msg.setBody}
                    placeholder={s.newMessagePlaceholder}
                    disabled={msg.smsBlocked}
                />
                {msg.channel === "sms" && msg.body.length > 0 ? (
                    <p className="text-xs text-muted">
                        {s.smsCount(msg.segments.chars, msg.segments.segments)}
                    </p>
                ) : null}
                {msg.error !== null ? <Notice tone="danger">{msg.error}</Notice> : null}
                <div className="flex justify-end gap-2 pt-1">
                    <Button variant="quiet" onPress={onClose}>
                        {s.cancel}
                    </Button>
                    <Button
                        icon="send"
                        busy={msg.busy}
                        disabled={msg.smsBlocked}
                        onPress={msg.submit}
                    >
                        {msg.busy ? s.sending : s.sendMessage}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
