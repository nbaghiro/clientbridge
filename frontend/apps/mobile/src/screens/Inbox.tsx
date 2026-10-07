import {
    type Channel,
    type Conversation,
    INBOX_FILTERS,
    type InboxSegmentKey,
    type InboxThread,
    channelLabel,
    consentDetail,
    consentLabel,
    strings,
    useConversation,
    useInbox,
    useMarkThreadRead,
    useNewMessage,
    useThreadComposer,
    visibleInboxSegments,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Badge,
    Button,
    Choice,
    ConversationRow,
    Empty,
    KeyValueList,
    MessageBubble,
    Modal,
    Money,
    Notice,
    SearchField,
    Select,
    Tabs,
    TextField,
} from "@clientbridge/ui";
import { type RouteProp, useRoute } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

import { Loaded } from "../components/Loaded";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";
import { useOpenLink } from "../lib/links";
import type { RootStackParamList } from "../navigation";
import { Broadcasts } from "./Broadcasts";
import { Contracts } from "./Contracts";
import { Forms } from "./Forms";
import { Reviews } from "./Reviews";

const c = theme.colors;
const s = strings.messaging;
const CHANNELS: Channel[] = ["sms", "email"];
const QUICK = s.quickReplyOptions.map((q, i) => ({ key: String(i), label: q.label, text: q.text }));

export function InboxScreen() {
    const segments = visibleInboxSegments(useRole());
    const params = useRoute<RouteProp<RootStackParamList, "Inbox">>().params;
    const [segment, setSegment] = useState<InboxSegmentKey>(params?.segment ?? "messages");

    return (
        <View style={styles.screen}>
            {segments.length > 1 ? (
                <Tabs items={segments} active={segment} onSelect={setSegment} />
            ) : null}
            {segment === "reviews" ? (
                <Reviews />
            ) : segment === "broadcasts" ? (
                <Broadcasts />
            ) : segment === "forms" ? (
                <Forms />
            ) : segment === "contracts" ? (
                <Contracts />
            ) : (
                <Messages />
            )}
        </View>
    );
}

function Messages() {
    const inbox = useInbox();
    const [openId, setOpenId] = useState<string | null>(null);
    const [composing, setComposing] = useState<string | null>(null);
    const [sentTo, setSentTo] = useState<string | null>(null);
    const params = useRoute<RouteProp<RootStackParamList, "Inbox">>().params;
    useEffect(() => {
        if (params?.create !== undefined) setComposing("");
    }, [params?.create]);
    const linked = inbox.threads.find((t) => t.client_id === params?.open);
    useEffect(() => {
        if (linked !== undefined) setOpenId(linked.id);
    }, [linked]);
    const open = inbox.threads.find((t) => t.id === openId) ?? null;

    if (open !== null)
        return (
            <ThreadView
                key={open.id}
                thread={open}
                onBack={() => {
                    setOpenId(null);
                }}
            />
        );

    return (
        <View style={styles.screen}>
            <View style={styles.header}>
                <View style={styles.headRow}>
                    <Text style={styles.meta}>{s.unreadCount(inbox.unread)}</Text>
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
                </View>
                <SearchField
                    value={inbox.q}
                    onChange={inbox.setQ}
                    placeholder={s.searchPlaceholder}
                />
            </View>
            <Tabs
                variant="pill"
                items={INBOX_FILTERS}
                active={inbox.filter}
                onSelect={inbox.setFilter}
            />
            <ScrollView style={styles.flex} contentContainerStyle={styles.listContent}>
                {sentTo !== null ? (
                    <View style={styles.pad}>
                        <Notice tone="success">{s.sentNew(sentTo)}</Notice>
                    </View>
                ) : null}
                <Loaded load={inbox.load} loading={s.loading} failed={s.loadError} rows={6}>
                    {inbox.filtered.length === 0 ? (
                        <Empty
                            message={inbox.threads.length === 0 ? s.noThreads : s.noThreadsFiltered}
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
                                tag={
                                    t.textsOff
                                        ? { label: s.textsOffShort, intent: "danger" }
                                        : undefined
                                }
                                onPress={() => {
                                    setOpenId(t.id);
                                }}
                            />
                        ))
                    )}
                </Loaded>
            </ScrollView>
            {composing !== null ? (
                <NewMessageSheet
                    clientId={composing}
                    onClose={() => {
                        setComposing(null);
                    }}
                    onSent={(sent) => {
                        setComposing(null);
                        const thread = inbox.threads.find((t) => t.client_id === sent.clientId);
                        if (thread === undefined) setSentTo(sent.name);
                        else setOpenId(thread.id);
                    }}
                />
            ) : null}
        </View>
    );
}

function ThreadView({ thread, onBack }: { thread: InboxThread; onBack: () => void }) {
    const conversation = useConversation(thread);
    const composer = useThreadComposer(api, thread);
    useMarkThreadRead(api, thread);
    const [details, setDetails] = useState(false);
    const scroll = useRef<ScrollView>(null);
    return (
        <KeyboardAvoidingView
            style={styles.screen}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
            <View style={styles.threadHead}>
                <Button variant="link" icon="chevronLeft" onPress={onBack}>
                    {s.back}
                </Button>
                <Text style={styles.threadTitle} numberOfLines={1}>
                    {thread.title}
                </Text>
                <Button
                    size="sm"
                    variant="outline"
                    onPress={() => {
                        setDetails(true);
                    }}
                >
                    {s.details}
                </Button>
            </View>
            {thread.textsOff ? (
                <View style={styles.pad}>
                    <Notice tone="danger" banner>
                        {`${s.textsOffTitle(thread.title.split(" ")[0] ?? "")} ${s.textsOffBody}`}
                    </Notice>
                </View>
            ) : null}
            <ScrollView
                ref={scroll}
                style={styles.flex}
                contentContainerStyle={styles.messages}
                onContentSizeChange={() => {
                    scroll.current?.scrollToEnd({ animated: false });
                }}
            >
                {conversation.days.map((day) => (
                    <View key={day.label} style={styles.day}>
                        <Text style={styles.dayLabel}>{day.label}</Text>
                        {day.items.map((item) => (
                            <MessageBubble
                                key={item.id}
                                body={item.body}
                                direction={item.direction}
                                meta={item.meta}
                                failed={item.failed}
                            />
                        ))}
                    </View>
                ))}
            </ScrollView>
            <View style={styles.composer}>
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
                <View style={styles.headRow}>
                    <Choice
                        layout="segmented"
                        label={s.channelLabel}
                        options={CHANNELS.map((ch) => ({ key: ch, label: s.channels[ch] }))}
                        value={composer.channel}
                        onChange={composer.setChannel}
                    />
                    <Button
                        icon="send"
                        busy={composer.busy}
                        disabled={!composer.canSend}
                        onPress={composer.submit}
                    >
                        {s.send}
                    </Button>
                </View>
                {composer.channel === "sms" && composer.body.length > 0 ? (
                    <Text style={styles.meta}>
                        {s.smsCount(composer.segments.chars, composer.segments.segments)}
                    </Text>
                ) : null}
            </View>
            {details ? (
                <Modal
                    open
                    size="xl"
                    onClose={() => {
                        setDetails(false);
                    }}
                >
                    <ScrollView>
                        <ContextPanel thread={thread} conversation={conversation} />
                    </ScrollView>
                </Modal>
            ) : null}
        </KeyboardAvoidingView>
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
        <View style={styles.gap}>
            <Text style={styles.threadTitle}>{thread.title}</Text>
            {client?.email !== undefined && client.email !== null ? (
                <Text style={styles.meta}>{client.email}</Text>
            ) : null}
            <View style={styles.headRow}>
                <View style={styles.flex}>
                    <Button
                        full
                        onPress={() => {
                            openLink("booking");
                        }}
                    >
                        {s.book}
                    </Button>
                </View>
                <View style={styles.flex}>
                    <Button
                        full
                        variant="outline"
                        onPress={() => {
                            openLink("client", thread.client_id);
                        }}
                    >
                        {s.openRecord}
                    </Button>
                </View>
            </View>
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
            <Text style={styles.section}>{s.consentTitle}</Text>
            {CHANNELS.map((ch) => {
                const v = conversation.consent[ch];
                const state = consentLabel(v);
                const detail = consentDetail(v);
                return (
                    <View key={ch} style={styles.consentRow}>
                        <View style={styles.flex}>
                            <Text style={styles.rowName}>{s.consentChannel[ch]}</Text>
                            {detail !== null ? <Text style={styles.meta}>{detail}</Text> : null}
                        </View>
                        <Badge label={state.label} intent={state.intent} />
                    </View>
                );
            })}
        </View>
    );
}

function NewMessageSheet({
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
        <Modal open size="xl" onClose={onClose}>
            <ScrollView contentContainerStyle={styles.gap} keyboardShouldPersistTaps="handled">
                <Text style={styles.threadTitle}>{s.newMessageTitle}</Text>
                <Select
                    label={s.clientLabel}
                    value={msg.clientId}
                    options={[{ key: "", label: s.chooseClient }, ...msg.clients]}
                    onChange={msg.setClientId}
                />
                <Choice
                    layout="segmented"
                    label={s.channelLabel}
                    options={CHANNELS.map((ch) => ({ key: ch, label: s.channels[ch] }))}
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
                {msg.error !== null ? <Notice tone="danger">{msg.error}</Notice> : null}
                <View style={styles.headRow}>
                    <View style={styles.flex}>
                        <Button full variant="outline" onPress={onClose}>
                            {s.cancel}
                        </Button>
                    </View>
                    <View style={styles.flex}>
                        <Button full busy={msg.busy} disabled={msg.smsBlocked} onPress={msg.submit}>
                            {s.sendMessage}
                        </Button>
                    </View>
                </View>
            </ScrollView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    flex: { flex: 1, minWidth: 0 },
    header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6, gap: 10 },
    headRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    meta: { color: c.muted, fontSize: 13, lineHeight: 18 },
    pad: { paddingHorizontal: 16, paddingTop: 8 },
    listContent: { paddingBottom: 24 },
    threadHead: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderBottomColor: c.border,
        borderBottomWidth: StyleSheet.hairlineWidth,
        backgroundColor: c.surface,
    },
    threadTitle: { flex: 1, color: c.ink, fontSize: 17, fontWeight: "700" },
    messages: { padding: 16, gap: 12 },
    day: { gap: 10 },
    dayLabel: {
        color: c.muted,
        fontSize: 11,
        fontWeight: "600",
        textAlign: "center",
        textTransform: "uppercase",
    },
    composer: {
        gap: 8,
        padding: 12,
        borderTopColor: c.border,
        borderTopWidth: StyleSheet.hairlineWidth,
        backgroundColor: c.surface,
    },
    gap: { gap: 12 },
    section: {
        color: c.muted,
        fontSize: 11,
        fontWeight: "600",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        marginTop: 6,
    },
    consentRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    rowName: { color: c.ink, fontSize: 14, fontWeight: "600" },
});
