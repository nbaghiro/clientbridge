import {
    type BroadcastResult,
    type Channel,
    MESSAGE_CHANNELS,
    type InboxSegmentKey,
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
    useMarkThreadRead,
    useThreadMessages,
    useThreads,
    visibleInboxSegments,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { useEffect, useState } from "react";
import { type RouteProp, useRoute } from "@react-navigation/native";
import {
    FlatList,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import {
    Badge,
    Button,
    Choice,
    Empty,
    Field,
    ListPage,
    Modal,
    Notice,
    StatusPill,
    Tabs,
    TextField,
} from "@clientbridge/ui";

import { api } from "../lib/api";
import type { RootStackParamList } from "../navigation";
import { useRole } from "../lib/auth";
import { Contracts } from "./Contracts";
import { Forms } from "./Forms";
import { Reviews } from "./Reviews";

const c = theme.colors;
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
    const threads = useThreads();
    const [openId, setOpenId] = useState<string | null>(null);
    const [composing, setComposing] = useState(false);
    const [broadcasting, setBroadcasting] = useState(false);
    const open = threads.find((t) => t.id === openId) ?? null;
    const params = useRoute<RouteProp<RootStackParamList, "Inbox">>().params;
    useEffect(() => {
        if (params?.create !== undefined) setComposing(true);
    }, [params?.create]);
    const linked = threads.find((t) => t.client_id === params?.open);
    useEffect(() => {
        if (linked !== undefined) setOpenId(linked.id);
    }, [linked]);

    return (
        <View style={styles.screen}>
            <ListPage
                summary={strings.messaging.subtitle}
                accessory={
                    <Button
                        variant="outline"
                        size="sm"
                        onPress={() => {
                            setBroadcasting(true);
                        }}
                    >
                        {strings.messaging.broadcast}
                    </Button>
                }
                action={{
                    label: strings.messaging.newShort,
                    onPress: () => {
                        setComposing(true);
                    },
                }}
                rows={threads}
                rowKey={(t) => t.id}
                onRowPress={(t) => {
                    setOpenId(t.id);
                }}
                empty={strings.messaging.noConversations}
                renderRow={(t) => <ThreadRowView thread={t} />}
            />

            <ThreadModal
                thread={open}
                onClose={() => {
                    setOpenId(null);
                }}
            />
            <ComposeModal
                visible={composing}
                onClose={() => {
                    setComposing(false);
                }}
            />
            <BroadcastModal
                visible={broadcasting}
                onClose={() => {
                    setBroadcasting(false);
                }}
            />
        </View>
    );
}

function ThreadRowView({ thread }: { thread: ThreadRow }) {
    return (
        <View style={styles.row}>
            <View style={styles.rowMain}>
                <Text style={styles.rowName} numberOfLines={1}>
                    {thread.client_name ?? strings.messaging.clientFallback}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                    {channelLabel(thread.channel)}
                    {thread.last_body !== null ? ` · ${thread.last_body}` : ""}
                </Text>
            </View>
            <View style={styles.rowRight}>
                {thread.last_message_at !== null ? (
                    <Text style={styles.time}>{formatRelativeTime(thread.last_message_at)}</Text>
                ) : null}
                {thread.unread_count > 0 ? (
                    <Badge variant="count" label={thread.unread_count} />
                ) : null}
            </View>
        </View>
    );
}

function ThreadModal({ thread, onClose }: { thread: ThreadRow | null; onClose: () => void }) {
    return (
        <Modal open={thread !== null} onClose={onClose} size="xl" framed={false}>
            <View style={styles.sheet}>
                {thread !== null ? <ThreadBody thread={thread} onClose={onClose} /> : null}
            </View>
        </Modal>
    );
}

function ThreadBody({ thread, onClose }: { thread: ThreadRow; onClose: () => void }) {
    const messages = useThreadMessages(thread.id);
    const compose = useComposeMessage(api, () => undefined, {
        clientId: thread.client_id,
        channel: thread.channel as Channel,
    });

    useMarkThreadRead(api, thread);

    return (
        <KeyboardAvoidingView
            style={styles.threadFill}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
            <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle} numberOfLines={1}>
                    {thread.client_name ?? strings.messaging.clientFallback}
                </Text>
                <Button variant="link" onPress={onClose}>
                    {strings.common.close}
                </Button>
            </View>

            <FlatList
                data={messages}
                keyExtractor={(m) => m.id}
                contentContainerStyle={styles.messages}
                renderItem={({ item }) => <Bubble message={item} />}
                ListEmptyComponent={<Empty message={strings.messaging.noMessages} />}
            />

            <View style={styles.composer}>
                {compose.error !== null ? <Notice tone="danger">{compose.error}</Notice> : null}
                <View style={styles.composerRow}>
                    <View style={styles.composerInput}>
                        <TextField
                            multiline
                            rows={1}
                            value={compose.body}
                            onChange={compose.setBody}
                            placeholder={strings.messaging.replyBy(
                                channelLabel(thread.channel).toLowerCase(),
                            )}
                        />
                    </View>
                    <Button
                        busy={compose.busy}
                        disabled={compose.body.trim().length === 0}
                        onPress={compose.submit}
                    >
                        {strings.messaging.send}
                    </Button>
                </View>
            </View>
        </KeyboardAvoidingView>
    );
}

function Bubble({ message }: { message: MessageRow }) {
    const outbound = message.direction === "out";
    return (
        <View style={[styles.bubbleRow, outbound ? styles.bubbleRight : styles.bubbleLeft]}>
            <View style={[styles.bubble, outbound ? styles.bubbleOut : styles.bubbleIn]}>
                <Text style={outbound ? styles.bubbleOutText : styles.bubbleInText}>
                    {message.body ?? ""}
                </Text>
            </View>
            <View style={[styles.bubbleMeta, outbound ? styles.metaRight : styles.metaLeft]}>
                <Text style={styles.time}>{formatTime(parseTimestamp(message.created_at))}</Text>
                {outbound ? (
                    <StatusPill
                        status={message.status}
                        intent={messageStatusIntent(message.status)}
                    />
                ) : null}
            </View>
        </View>
    );
}

function ChannelToggle({ value, onChange }: { value: Channel; onChange: (ch: Channel) => void }) {
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

function ComposeModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
    const compose = useComposeMessage(api, onClose);
    const clients = useClients();

    return (
        <Modal open={visible} onClose={onClose}>
            <Text style={styles.sheetTitle}>{strings.messaging.newMessageTitle}</Text>
            <ScrollView contentContainerStyle={styles.formBody}>
                <Field label={strings.messaging.clientLabel}>
                    {clients.length === 0 ? (
                        <Text style={styles.muted}>{strings.messaging.addClientFirst}</Text>
                    ) : (
                        <Choice
                            label={strings.messaging.clientLabel}
                            options={clients.map((cl) => ({ key: cl.id, label: cl.name }))}
                            value={compose.clientId}
                            onChange={compose.setClientId}
                        />
                    )}
                </Field>
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
            </ScrollView>
            <ModalActions
                busy={compose.busy}
                onCancel={onClose}
                onSubmit={compose.submit}
                label={strings.messaging.send}
            />
        </Modal>
    );
}

function BroadcastModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
    const [sent, setSent] = useState<BroadcastResult | null>(null);
    const form = useBroadcastForm(api, setSent);

    const close = (): void => {
        setSent(null);
        onClose();
    };

    return (
        <Modal open={visible} onClose={close}>
            {sent !== null ? (
                <View style={styles.center}>
                    <Text style={styles.sheetTitle}>
                        {sent.status === "scheduled"
                            ? strings.messaging.broadcastScheduled
                            : strings.messaging.broadcastSent}
                    </Text>
                    <Text style={styles.muted}>
                        {strings.messaging.broadcastRecipientsShort(
                            sent.name,
                            sent.recipient_count,
                        )}
                    </Text>
                    <Button onPress={close}>{strings.common.done}</Button>
                </View>
            ) : (
                <>
                    <Text style={styles.sheetTitle}>{strings.messaging.newBroadcastTitle}</Text>
                    <ScrollView contentContainerStyle={styles.formBody}>
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
                            placeholder={strings.messaging.tagsPlaceholderShort}
                        />
                        {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                    </ScrollView>
                    <ModalActions
                        busy={form.busy}
                        onCancel={close}
                        onSubmit={form.submit}
                        label={strings.messaging.sendBroadcast}
                    />
                </>
            )}
        </Modal>
    );
}

function ModalActions({
    busy,
    onCancel,
    onSubmit,
    label,
}: {
    busy: boolean;
    onCancel: () => void;
    onSubmit: () => void;
    label: string;
}) {
    return (
        <View style={styles.actions}>
            <Button variant="quiet" onPress={onCancel}>
                {strings.common.cancel}
            </Button>
            <Button busy={busy} onPress={onSubmit}>
                {busy ? strings.messaging.sending : label}
            </Button>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    rowMain: { flex: 1 },
    rowName: { color: c.ink, fontSize: 15, fontWeight: "600" },
    rowSub: { color: c.muted, fontSize: 13, marginTop: 1 },
    rowRight: { alignItems: "flex-end", gap: 4 },
    time: { color: c.muted, fontSize: 12 },
    muted: { color: c.muted, fontSize: 14 },
    sheet: { flex: 1, backgroundColor: c.surface },
    threadFill: { flex: 1 },
    sheetHead: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        paddingVertical: 14,
        borderBottomColor: c.border,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    sheetTitle: { color: c.ink, fontSize: 17, fontWeight: "700" },
    messages: { paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
    bubbleRow: { maxWidth: "82%" },
    bubbleLeft: { alignSelf: "flex-start", alignItems: "flex-start" },
    bubbleRight: { alignSelf: "flex-end", alignItems: "flex-end" },
    bubble: { borderRadius: 16, paddingHorizontal: 13, paddingVertical: 9 },
    bubbleIn: { backgroundColor: c.bg, borderColor: c.border, borderWidth: theme.borderWidth },
    bubbleOut: { backgroundColor: c.accent },
    bubbleInText: { color: c.ink, fontSize: 14, lineHeight: 19 },
    bubbleOutText: { color: c.accentInk, fontSize: 14, lineHeight: 19 },
    bubbleMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
    metaLeft: { justifyContent: "flex-start" },
    metaRight: { justifyContent: "flex-end" },
    composer: {
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderTopColor: c.border,
        borderTopWidth: StyleSheet.hairlineWidth,
        backgroundColor: c.surface,
    },
    composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
    composerInput: { flex: 1 },
    formBody: { paddingVertical: 12, gap: 2 },
    center: { alignItems: "center", gap: 12, paddingVertical: 20 },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 8 },
});
