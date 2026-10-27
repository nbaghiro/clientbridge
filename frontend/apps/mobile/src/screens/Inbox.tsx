import {
    type Channel,
    type Conversation,
    INBOX_FILTERS,
    type InboxSegmentKey,
    type InboxThread,
    channelLabel,
    consentDetail,
    consentLabel,
    firstName,
    strings,
    useConversation,
    useInbox,
    resolveInboxTarget,
    useMarkThreadRead,
    useNewMessage,
    usePeoplePhotos,
    useThreadComposer,
    visibleInboxSegments,
    quickReplies,
    BUSINESS_CURRENCY,
    useBusinessZone,
    kindWord,
    useSubjectKind,
    openTask,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Backdrop,
    Badge,
    Button,
    Choice,
    ConversationRow,
    Empty,
    IconButton,
    PageHeader,
    SheetHeader,
    KeyValueList,
    MessageBubble,
    Modal,
    Money,
    Notice,
    SearchField,
    SearchSelect,
    Tabs,
    TextField,
    useTabletLayout,
} from "@clientbridge/ui";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { type RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import {
    FlatList,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";

import { Loaded } from "../components/Loaded";
import { SplitView } from "../components/SplitView";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";
import { useOpenLink } from "../lib/links";
import type { TabParamList } from "../navigation";
import { SafeAreaView } from "react-native-safe-area-context";

import { Broadcasts } from "./Broadcasts";
import { Contracts } from "./Contracts";
import { Forms } from "./Forms";
import { Reviews } from "./Reviews";

const c = theme.colors;
const s = strings.messaging;
const CHANNELS: Channel[] = ["sms", "email"];

export function InboxScreen() {
    const segments = visibleInboxSegments(useRole());
    const params = useRoute<RouteProp<TabParamList, "Inbox">>().params;
    const [segment, setSegment] = useState<InboxSegmentKey>(params?.segment ?? "messages");

    useEffect(() => {
        if (params?.segment !== undefined) setSegment(params.segment);
    }, [params?.segment, params?.request]);
    const current = segments.some((item) => item.key === segment) ? segment : "messages";

    return (
        <SafeAreaView style={styles.screen} edges={["top"]}>
            <Backdrop />
            <PageHeader style={styles.inboxTitle} title={strings.navigation.inbox} />
            {segments.length > 1 ? (
                <Tabs items={segments} active={current} onSelect={setSegment} />
            ) : null}
            {current === "reviews" ? (
                <Reviews />
            ) : current === "broadcasts" ? (
                <Broadcasts />
            ) : current === "forms" ? (
                <Forms />
            ) : current === "contracts" ? (
                <Contracts />
            ) : (
                <Messages />
            )}
        </SafeAreaView>
    );
}

function Messages() {
    const photos = usePeoplePhotos();
    const kind = useSubjectKind();
    const nav = useNavigation<BottomTabNavigationProp<TabParamList, "Inbox">>();
    const inbox = useInbox();
    const [openId, setOpenId] = useState<string | null>(null);
    const [composing, setComposing] = useState<string | null>(null);
    const [sentTo, setSentTo] = useState<string | null>(null);
    const params = useRoute<RouteProp<TabParamList, "Inbox">>().params;
    const handled = useRef<number | undefined>(undefined);
    useEffect(() => {
        const request = params?.request;
        if (
            params?.segment !== "messages" ||
            request === undefined ||
            handled.current === request ||
            !inbox.load.hasData
        )
            return;
        handled.current = request;
        nav.setParams({
            request: undefined,
            create: undefined,
            open: undefined,
            threadId: undefined,
        });
        setSentTo(null);
        if (params.create !== undefined) {
            setOpenId(null);
            setComposing("");
            return;
        }
        const target = resolveInboxTarget(inbox.threads, {
            threadId: params.threadId,
            clientId: params.open,
        });
        setOpenId(target.threadId);
        setComposing(target.clientId);
    }, [params, inbox.load.hasData, inbox.threads, nav]);
    const open = inbox.threads.find((t) => t.id === openId) ?? null;
    const tablet = useTabletLayout();

    if (open !== null && !tablet)
        return (
            <ThreadView
                key={open.id}
                thread={open}
                onBack={() => {
                    setOpenId(null);
                }}
            />
        );

    const list = (
        <>
            <View style={styles.header}>
                <View style={styles.headRow}>
                    <Text style={styles.meta}>{s.unreadCount(inbox.unread)}</Text>
                    <Button
                        style={{ alignSelf: "center" }}
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
                    placeholder={s.searchPlaceholder(kindWord(kind))}
                />
            </View>
            <Tabs
                variant="pill"
                items={INBOX_FILTERS}
                active={inbox.filter}
                onSelect={inbox.setFilter}
            />
            <Loaded flush load={inbox.load} loading={s.loading} failed={s.loadError} rows={6}>
                <FlatList
                    style={styles.flex}
                    contentContainerStyle={styles.listContent}
                    data={inbox.filtered}
                    keyExtractor={(thread) => thread.id}
                    ListHeaderComponent={
                        sentTo === null ? null : (
                            <View style={styles.pad}>
                                <Notice tone="success">{s.sentNew(sentTo)}</Notice>
                            </View>
                        )
                    }
                    ListEmptyComponent={
                        <Empty
                            message={
                                inbox.threads.length === 0 ? s.noThreadsTitle : s.noThreadsFiltered
                            }
                            {...(inbox.threads.length === 0 ? { body: s.noThreadsBody } : {})}
                        />
                    }
                    renderItem={({ item: t }) => (
                        <ConversationRow
                            name={t.title}
                            src={photos.client(t.client_id)}
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
                    )}
                />
            </Loaded>
        </>
    );
    return (
        <View style={styles.screen}>
            {tablet ? (
                <SplitView
                    list={list}
                    detail={open !== null ? <ThreadView key={open.id} thread={open} /> : null}
                    icon="inbox"
                    placeholder={inbox.load.hasData ? s.selectThread : null}
                />
            ) : (
                list
            )}
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

function ThreadView({ thread, onBack }: { thread: InboxThread; onBack?: () => void }) {
    const conversation = useConversation(api, thread);
    const composer = useThreadComposer(api, thread);
    useMarkThreadRead(api, thread);
    const [details, setDetails] = useState(false);
    const scroll = useRef<ScrollView>(null);
    const newest = conversation.days.at(-1)?.items.at(-1)?.id;
    const scrolledTo = useRef<string | undefined>(undefined);
    return (
        <KeyboardAvoidingView
            style={styles.screen}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
            <View style={styles.threadHead}>
                {onBack !== undefined ? (
                    <IconButton icon="chevronLeft" label={s.back} onPress={onBack} />
                ) : null}
                <Text style={[styles.threadTitle, styles.flex]} numberOfLines={1}>
                    {thread.title}
                </Text>
                <Button
                    style={{ alignSelf: "center" }}
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
                        {strings.common.twoSentences(
                            s.textsOffTitle(firstName(thread.title)),
                            s.textsOffBody,
                        )}
                    </Notice>
                </View>
            ) : null}
            <ScrollView
                ref={scroll}
                style={styles.flex}
                contentContainerStyle={styles.messages}
                onContentSizeChange={() => {
                    if (scrolledTo.current === newest) return;
                    scrolledTo.current = newest;
                    scroll.current?.scrollToEnd({ animated: false });
                }}
            >
                {conversation.earlier.show ? (
                    <View style={styles.earlier}>
                        <View style={styles.earlierAction}>
                            <Button
                                size="sm"
                                variant="quiet"
                                busy={conversation.earlier.busy}
                                onPress={conversation.earlier.load}
                            >
                                {s.thread.showEarlier}
                            </Button>
                        </View>
                        {conversation.earlier.error !== null ? (
                            <Notice tone="danger">{conversation.earlier.error}</Notice>
                        ) : null}
                    </View>
                ) : null}
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
                <View style={styles.headRow}>
                    <Choice
                        layout="segmented"
                        label={s.channelLabel}
                        options={CHANNELS.map((ch) => ({ key: ch, label: s.channels[ch] }))}
                        value={composer.channel}
                        onChange={composer.setChannel}
                    />
                    <Button
                        style={{ alignSelf: "center" }}
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
                        <ContextPanel
                            thread={thread}
                            conversation={conversation}
                            onLeave={() => {
                                setDetails(false);
                            }}
                        />
                    </ScrollView>
                </Modal>
            ) : null}
        </KeyboardAvoidingView>
    );
}

function ContextPanel({
    thread,
    conversation,
    onLeave,
}: {
    thread: InboxThread;
    conversation: Conversation;
    onLeave: () => void;
}) {
    const kind = useSubjectKind();
    const zone = useBusinessZone();
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
                            onLeave();
                            openTask({ kind: "booking", clientId: thread.client_id });
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
                            onLeave();
                            openLink("client", thread.client_id);
                        }}
                    >
                        {s.openRecord}
                    </Button>
                </View>
            </View>
            <KeyValueList
                rows={[
                    ...(kind === null
                        ? []
                        : [
                              {
                                  label: strings.subjects.many(kind),
                                  value: client?.subject_names ?? "—",
                              },
                          ]),
                    {
                        label: s.balance,
                        value:
                            balance > 0 ? (
                                <Money currency={BUSINESS_CURRENCY} cents={balance} />
                            ) : (
                                s.settled
                            ),
                        intent: balance > 0 ? "warning" : undefined,
                    },
                    { label: s.nextVisit, value: conversation.nextVisit ?? s.nothingBooked },
                ]}
            />
            <Text style={styles.section}>{s.consentTitle}</Text>
            {CHANNELS.map((ch) => {
                const v = conversation.consent[ch];
                const state = consentLabel(v);
                const detail = consentDetail(v, zone);
                return (
                    <View key={ch} style={styles.consentRow}>
                        <View style={styles.flex}>
                            <Text style={styles.rowName}>{s.consentChannel[ch]}</Text>
                            {detail !== null ? <Text style={styles.meta}>{detail}</Text> : null}
                        </View>
                        <Badge
                            style={{ alignSelf: "center" }}
                            label={state.label}
                            intent={state.intent}
                        />
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
                <SheetHeader title={s.newMessageTitle} />
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
    earlier: { gap: 8 },
    earlierAction: { flexDirection: "row", justifyContent: "center" },
    inboxTitle: { paddingHorizontal: 20, paddingVertical: 8 },
    screen: { flex: 1 },
    flex: { flex: 1, minWidth: 0 },
    header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6, gap: 10 },
    headRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
    },
    meta: { color: c.muted, fontFamily: theme.fonts.ui, fontSize: 13, lineHeight: 18 },
    pad: { paddingHorizontal: 16, paddingTop: 8 },
    listContent: {
        paddingBottom: 24,
        borderTopColor: c.borderSoft,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
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
    threadTitle: {
        color: c.ink,
        fontFamily: theme.fonts.ui,
        fontSize: theme.type.section,
        fontWeight: "700",
    },
    messages: { padding: 16, gap: 12 },
    day: { gap: 10 },
    dayLabel: {
        color: c.muted,
        fontFamily: theme.fonts.ui,
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
        fontFamily: theme.fonts.ui,
        fontSize: 11,
        fontWeight: "600",
        letterSpacing: 0.5,
        textTransform: "uppercase",
        marginTop: 6,
    },
    consentRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    rowName: { color: c.ink, fontFamily: theme.fonts.ui, fontSize: 14, fontWeight: "600" },
});
