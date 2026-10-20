import {
    type Channel,
    INBOX_FILTERS,
    type InboxSegmentKey,
    type InboxThread,
    type ThreadComposer,
    channelLabel,
    formatPhone,
    strings,
    useConversation,
    useInbox,
    useMarkThreadRead,
    useNewMessage,
    usePeoplePhotos,
    useThreadComposer,
    visibleInboxSegments,
    formatParts,
    quickReplies,
    kindWord,
    useSubjectKind,
} from "@clientbridge/app-core";
import {
    Avatar,
    Button,
    Choice,
    ConversationRow,
    DetailView,
    Empty,
    MessageBubble,
    Modal,
    Notice,
    PageHeader,
    SearchField,
    SearchSelect,
    Skeleton,
    Tabs,
    TextField,
} from "@clientbridge/ui";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ContextPanel, ThreadDetails } from "../components/ThreadDetails";
import { Loaded } from "../components/Loaded";
import { useWide } from "../components/ScheduleGrid";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";
import { useLinkIntent } from "../lib/links";
import { Broadcasts } from "./Broadcasts";
import { Contracts } from "./Contracts";
import { Forms } from "./Forms";
import { Reviews } from "./Reviews";
import { FILL, PageFrame } from "../components/PageFrame";

const s = strings.messaging;
const CHANNELS: Channel[] = ["sms", "email"];

export function Inbox() {
    const segments = visibleInboxSegments(useRole());
    const [params, setParams] = useSearchParams();
    const segment: InboxSegmentKey =
        segments.find((x) => x.key === params.get("segment"))?.key ?? "messages";
    const setSegment = (key: InboxSegmentKey): void => {
        setParams(key === "messages" ? {} : { segment: key });
    };
    const inbox = useInbox();
    const [picked, setPicked] = useState<string | null>(null);
    const open =
        segment === "messages" ? (inbox.threads.find((t) => t.id === picked) ?? null) : null;
    const wide = useWide();
    const area = segments.find((x) => x.key === segment);

    return (
        <PageFrame>
            <PageHeader title={s.title}>
                {segments.length > 1 ? (
                    <div className="border-b border-line">
                        <Tabs items={segments} active={segment} onSelect={setSegment} />
                    </div>
                ) : null}
            </PageHeader>
            <div className="mt-6">
                {segment === "messages" || area === undefined ? (
                    <Messages inbox={inbox} picked={open} onPick={setPicked} wide={wide} />
                ) : segment === "reviews" ? (
                    <Reviews />
                ) : segment === "broadcasts" ? (
                    <Broadcasts />
                ) : segment === "forms" ? (
                    <Forms />
                ) : (
                    <Contracts />
                )}
            </div>
        </PageFrame>
    );
}

const rowFlag = (t: InboxThread): { label: string; intent: "danger" } | undefined =>
    t.textsOff ? { label: s.textsOffShort, intent: "danger" } : undefined;

function Messages({
    inbox,
    picked: open,
    onPick: setPicked,
    wide,
}: {
    inbox: ReturnType<typeof useInbox>;
    picked: InboxThread | null;
    onPick: (id: string) => void;
    wide: boolean;
}) {
    const photos = usePeoplePhotos();
    const kind = useSubjectKind();
    const [details, setDetails] = useState(false);
    const [composing, setComposing] = useState<string | null>(null);
    const [sentTo, setSentTo] = useState<string | null>(null);
    // A client opened from elsewhere with no conversation yet gets a blank one to write in.
    const [drafting, setDrafting] = useState<string | null>(null);
    const nothingYet = inbox.load.hasData && inbox.threads.length === 0 && drafting === null;
    const pick = (id: string): void => {
        setDrafting(null);
        setPicked(id);
    };
    useLinkIntent({
        onCreate: () => {
            setComposing("");
        },
        onOpen: (clientId) => {
            const thread = inbox.threads.find((t) => t.client_id === clientId);
            if (thread === undefined) setDrafting(clientId);
            else pick(thread.id);
        },
    });
    const draftThread =
        drafting === null ? undefined : inbox.threads.find((t) => t.client_id === drafting);
    useEffect(() => {
        if (draftThread !== undefined) pick(draftThread.id);
    });

    return (
        <div>
            {nothingYet ? (
                <Empty
                    variant="card"
                    icon="inbox"
                    message={s.noThreadsTitle}
                    body={s.noThreadsBody}
                    actions={
                        <Button
                            onPress={() => {
                                setSentTo(null);
                                setComposing("");
                            }}
                        >
                            {s.newMessageTitle}
                        </Button>
                    }
                />
            ) : (
                <div
                    className={`flex ${FILL} overflow-hidden rounded-lg border border-line bg-surface shadow-card`}
                >
                    <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-surface">
                        <header className="space-y-3 border-b border-line px-4 pb-3 pt-4">
                            <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                    {inbox.load.hasData ? (
                                        <p className="text-sm font-semibold text-ink">
                                            {s.unreadCount(inbox.unread)}
                                        </p>
                                    ) : (
                                        <Skeleton variant="line" label={s.loading} />
                                    )}
                                </div>
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
                                placeholder={s.searchPlaceholder(kindWord(kind))}
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
                            <Loaded
                                load={inbox.load}
                                loading={s.loading}
                                failed={s.loadError}
                                rows={8}
                                flush
                            >
                                {inbox.filtered.length === 0 ? (
                                    <Empty
                                        message={
                                            inbox.threads.length === 0
                                                ? s.noThreadsTitle
                                                : s.noThreadsFiltered
                                        }
                                    />
                                ) : (
                                    inbox.filtered.map((t) => (
                                        <ConversationRow
                                            key={t.id}
                                            name={t.title}
                                            src={photos.client(t.client_id)}
                                            preview={t.last_body ?? ""}
                                            at={t.ago}
                                            unread={t.unread_count}
                                            channel={t.channelKind}
                                            channelLabel={channelLabel(t.channel)}
                                            selected={t.id === open?.id}
                                            tag={rowFlag(t)}
                                            onPress={() => {
                                                pick(t.id);
                                            }}
                                        />
                                    ))
                                )}
                            </Loaded>
                        </nav>
                    </aside>
                    {open !== null ? (
                        <>
                            <Thread
                                key={open.id}
                                thread={open}
                                details={details}
                                onDetails={setDetails}
                                wide={wide}
                            />
                            {wide ? (
                                <ThreadDetails key={`details-${open.id}`} thread={open} />
                            ) : null}
                        </>
                    ) : drafting !== null ? (
                        <NewThread
                            key={drafting}
                            clientId={drafting}
                            onSent={(sent) => {
                                setSentTo(sent.name);
                            }}
                        />
                    ) : (
                        // No conversation opens on its own: someone may be looking at the screen too.
                        <section className="flex flex-1 items-center justify-center bg-bg/60 pb-16">
                            {inbox.load.hasData ? (
                                <Empty icon="inbox" message={s.selectThread} />
                            ) : null}
                        </section>
                    )}
                </div>
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
                        else pick(thread.id);
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
    wide,
}: {
    thread: InboxThread;
    details: boolean;
    onDetails: (v: boolean) => void;
    wide: boolean;
}) {
    const photos = usePeoplePhotos();
    const conversation = useConversation(api, thread);
    const composer = useThreadComposer(api, thread);
    useMarkThreadRead(api, thread);
    const end = useRef<HTMLDivElement>(null);
    const newest = conversation.days.at(-1)?.items.at(-1)?.id;
    useEffect(() => {
        end.current?.scrollIntoView({ block: "end" });
    }, [newest, thread.id]);
    const contact = thread.channel === "email" ? thread.email : formatPhone(thread.phone);

    return (
        <>
            <section className="flex min-w-0 flex-1 flex-col bg-bg">
                <div className="flex items-center gap-3 border-b border-line bg-surface px-5 py-3">
                    <Avatar name={thread.title} src={photos.client(thread.client_id)} />
                    <div className="min-w-0 flex-1">
                        <h2 className="truncate font-display text-base font-bold text-ink">
                            {thread.title}
                        </h2>
                        <p className="truncate text-xs text-muted">
                            {formatParts([channelLabel(thread.channel), contact])}
                        </p>
                    </div>
                    {wide ? null : (
                        <Button
                            size="sm"
                            variant="outline"
                            onPress={() => {
                                onDetails(true);
                            }}
                        >
                            {s.details}
                        </Button>
                    )}
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
                    {conversation.earlier.show ? (
                        <div className="flex flex-col items-center gap-2">
                            <Button
                                size="sm"
                                variant="quiet"
                                busy={conversation.earlier.busy}
                                onPress={conversation.earlier.load}
                            >
                                {s.thread.showEarlier}
                            </Button>
                            {conversation.earlier.error !== null ? (
                                <Notice tone="danger">{conversation.earlier.error}</Notice>
                            ) : null}
                        </div>
                    ) : null}
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
            <DetailView
                open={details && !wide}
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
                options={quickReplies()}
                value={null}
                onChange={(k) => {
                    composer.setBody(quickReplies().find((q) => q.key === k)?.text ?? "");
                }}
            />
            <TextField
                multiline
                rows={2}
                name={s.replyPlaceholder(composer.channel)}
                value={composer.body}
                onChange={composer.setBody}
                placeholder={s.replyPlaceholder(composer.channel)}
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

function NewThread({
    clientId,
    onSent,
}: {
    clientId: string;
    onSent: (sent: { clientId: string; name: string }) => void;
}) {
    const photos = usePeoplePhotos();
    const msg = useNewMessage(api, onSent, clientId);
    const name = msg.clients.find((c) => c.key === clientId)?.label ?? "";
    return (
        <section className="flex min-w-0 flex-1 flex-col bg-bg">
            <div className="flex items-center gap-3 border-b border-line bg-surface px-5 py-3">
                <Avatar name={name} src={photos.client(clientId)} />
                <h2 className="min-w-0 flex-1 truncate font-display text-base font-bold text-ink">
                    {name}
                </h2>
            </div>
            <div className="flex flex-1 items-center justify-center px-5 pb-16">
                <Empty icon="inbox" message={s.noMessagesYet(name)} />
            </div>
            <div className="space-y-2.5 border-t border-line bg-surface px-5 py-3">
                {msg.smsBlocked ? <Notice tone="danger">{s.smsBlockedNew}</Notice> : null}
                <TextField
                    multiline
                    rows={2}
                    name={s.replyPlaceholder(msg.channel)}
                    value={msg.body}
                    onChange={msg.setBody}
                    placeholder={s.replyPlaceholder(msg.channel)}
                    disabled={msg.smsBlocked}
                />
                {msg.error !== null ? <Notice tone="danger">{msg.error}</Notice> : null}
                <div className="flex flex-wrap items-center gap-3">
                    <Choice
                        layout="segmented"
                        label={s.channelLabel}
                        options={CHANNELS.map((c) => ({ key: c, label: s.channels[c] }))}
                        value={msg.channel}
                        onChange={msg.setChannel}
                    />
                    {msg.channel === "sms" && msg.body.length > 0 ? (
                        <span className="text-xs text-muted">
                            {s.smsCount(msg.segments.chars, msg.segments.segments)}
                        </span>
                    ) : null}
                    <span className="ml-auto">
                        <Button
                            icon="send"
                            busy={msg.busy}
                            disabled={msg.smsBlocked}
                            onPress={msg.submit}
                        >
                            {msg.busy ? s.sending : s.send}
                        </Button>
                    </span>
                </div>
            </div>
        </section>
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
                <SearchSelect
                    label={s.clientLabel}
                    value={msg.clientId}
                    placeholder={s.chooseClient}
                    options={msg.clients}
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
