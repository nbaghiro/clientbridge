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
import { theme } from "@clientbridge/tokens/theme";
import { useState } from "react";
import {
    FlatList,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import { Segmented } from "../components/Segmented";
import { ListPage } from "../ui/ListPage";
import { StatusPill } from "../ui/StatusPill";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";
import { Reviews } from "./Reviews";
import { Modal } from "../ui/Modal";

const c = theme.colors;
export function InboxScreen() {
    const segments = visibleInboxSegments(useRole());
    const [segment, setSegment] = useState<InboxSegmentKey>("messages");

    return (
        <View style={styles.screen}>
            {segments.length > 1 ? (
                <Segmented items={segments} active={segment} onSelect={setSegment} />
            ) : null}
            {segment === "reviews" ? <Reviews /> : <Messages />}
        </View>
    );
}

function Messages() {
    const threads = useThreads();
    const [openId, setOpenId] = useState<string | null>(null);
    const [composing, setComposing] = useState(false);
    const [broadcasting, setBroadcasting] = useState(false);
    const open = threads.find((t) => t.id === openId) ?? null;

    return (
        <View style={styles.screen}>
            <ListPage
                summary={strings.inbox.subtitle}
                accessory={
                    <Pressable
                        style={styles.ghostBtn}
                        onPress={() => {
                            setBroadcasting(true);
                        }}
                    >
                        <Text style={styles.ghostText}>{strings.inbox.broadcast}</Text>
                    </Pressable>
                }
                action={{
                    label: strings.inbox.newShort,
                    onPress: () => {
                        setComposing(true);
                    },
                }}
                rows={threads}
                rowKey={(t) => t.id}
                onRowPress={(t) => {
                    setOpenId(t.id);
                }}
                empty={strings.inbox.noConversations}
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
                    {thread.client_name ?? strings.inbox.clientFallback}
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
                    <View style={styles.unread}>
                        <Text style={styles.unreadText}>{thread.unread_count}</Text>
                    </View>
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
                    {thread.client_name ?? strings.inbox.clientFallback}
                </Text>
                <Pressable onPress={onClose}>
                    <Text style={styles.closeText}>{strings.common.close}</Text>
                </Pressable>
            </View>

            <FlatList
                data={messages}
                keyExtractor={(m) => m.id}
                contentContainerStyle={styles.messages}
                renderItem={({ item }) => <Bubble message={item} />}
                ListEmptyComponent={<Text style={styles.muted}>{strings.inbox.noMessages}</Text>}
            />

            <View style={styles.composer}>
                {compose.error !== null ? <Text style={styles.error}>{compose.error}</Text> : null}
                <View style={styles.composerRow}>
                    <TextInput
                        style={styles.composerInput}
                        value={compose.body}
                        onChangeText={compose.setBody}
                        placeholder={strings.inbox.replyBy(
                            channelLabel(thread.channel).toLowerCase(),
                        )}
                        placeholderTextColor={c.muted}
                        multiline
                    />
                    <Pressable
                        style={[
                            styles.sendBtn,
                            (compose.busy || compose.body.trim().length === 0) && styles.btnBusy,
                        ]}
                        disabled={compose.busy || compose.body.trim().length === 0}
                        onPress={compose.submit}
                    >
                        <Text style={styles.sendText}>
                            {compose.busy ? strings.common.busyEllipsis : strings.inbox.send}
                        </Text>
                    </Pressable>
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
        <View style={styles.chipWrap}>
            {MESSAGE_CHANNELS.map((ch) => (
                <Pressable
                    key={ch}
                    style={[styles.chip, value === ch && styles.chipOn]}
                    onPress={() => {
                        onChange(ch);
                    }}
                >
                    <Text style={[styles.chipText, value === ch && styles.chipTextOn]}>
                        {channelLabel(ch)}
                    </Text>
                </Pressable>
            ))}
        </View>
    );
}

function ComposeModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
    const compose = useComposeMessage(api, onClose);
    const clients = useClients();

    return (
        <Modal open={visible} onClose={onClose}>
            <Text style={styles.sheetTitle}>{strings.inbox.newMessageTitle}</Text>
            <ScrollView contentContainerStyle={styles.formBody}>
                <Text style={styles.fieldLabel}>{strings.inbox.clientLabel}</Text>
                {clients.length === 0 ? (
                    <Text style={styles.muted}>{strings.inbox.addClientFirst}</Text>
                ) : (
                    <View style={styles.chipWrap}>
                        {clients.map((cl) => (
                            <Pressable
                                key={cl.id}
                                style={[styles.chip, compose.clientId === cl.id && styles.chipOn]}
                                onPress={() => {
                                    compose.setClientId(cl.id);
                                }}
                            >
                                <Text
                                    style={[
                                        styles.chipText,
                                        compose.clientId === cl.id && styles.chipTextOn,
                                    ]}
                                >
                                    {cl.name}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                )}

                <Text style={[styles.fieldLabel, styles.fieldSpace]}>
                    {strings.inbox.channelLabel}
                </Text>
                <ChannelToggle value={compose.channel} onChange={compose.setChannel} />

                <Text style={[styles.fieldLabel, styles.fieldSpace]}>
                    {strings.inbox.messageLabel}
                </Text>
                <TextInput
                    style={styles.textArea}
                    value={compose.body}
                    onChangeText={compose.setBody}
                    placeholder={strings.inbox.messagePlaceholder}
                    placeholderTextColor={c.muted}
                    multiline
                />
                {compose.error !== null ? <Text style={styles.error}>{compose.error}</Text> : null}
            </ScrollView>
            <ModalActions
                busy={compose.busy}
                onCancel={onClose}
                onSubmit={compose.submit}
                label={strings.inbox.send}
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
                            ? strings.inbox.broadcastScheduled
                            : strings.inbox.broadcastSent}
                    </Text>
                    <Text style={styles.muted}>
                        {strings.inbox.broadcastRecipientsShort(sent.name, sent.recipient_count)}
                    </Text>
                    <Pressable style={styles.add} onPress={close}>
                        <Text style={styles.addText}>{strings.common.done}</Text>
                    </Pressable>
                </View>
            ) : (
                <>
                    <Text style={styles.sheetTitle}>{strings.inbox.newBroadcastTitle}</Text>
                    <ScrollView contentContainerStyle={styles.formBody}>
                        <Text style={styles.fieldLabel}>{strings.inbox.nameLabel}</Text>
                        <TextInput
                            style={styles.input}
                            value={form.name}
                            onChangeText={form.setName}
                            placeholder={strings.inbox.namePlaceholder}
                            placeholderTextColor={c.muted}
                        />
                        <Text style={[styles.fieldLabel, styles.fieldSpace]}>
                            {strings.inbox.channelLabel}
                        </Text>
                        <ChannelToggle value={form.channel} onChange={form.setChannel} />
                        <Text style={[styles.fieldLabel, styles.fieldSpace]}>
                            {strings.inbox.messageLabel}
                        </Text>
                        <TextInput
                            style={styles.textArea}
                            value={form.body}
                            onChangeText={form.setBody}
                            placeholder={strings.inbox.announcementPlaceholder}
                            placeholderTextColor={c.muted}
                            multiline
                        />
                        <Text style={[styles.fieldLabel, styles.fieldSpace]}>
                            {strings.inbox.audienceTagsOptional}
                        </Text>
                        <TextInput
                            style={styles.input}
                            value={form.tags}
                            onChangeText={form.setTags}
                            placeholder={strings.inbox.tagsPlaceholderShort}
                            placeholderTextColor={c.muted}
                            autoCapitalize="none"
                        />
                        {form.error !== null ? (
                            <Text style={styles.error}>{form.error}</Text>
                        ) : null}
                    </ScrollView>
                    <ModalActions
                        busy={form.busy}
                        onCancel={close}
                        onSubmit={form.submit}
                        label={strings.inbox.sendBroadcast}
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
            <Pressable style={styles.cancel} onPress={onCancel}>
                <Text style={styles.cancelText}>{strings.common.cancel}</Text>
            </Pressable>
            <Pressable
                style={[styles.save, busy && styles.btnBusy]}
                disabled={busy}
                onPress={onSubmit}
            >
                <Text style={styles.saveText}>{busy ? strings.inbox.sending : label}</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    ghostBtn: {
        borderColor: c.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    ghostText: { color: c.inkSoft, fontSize: 13, fontWeight: "700" },
    add: {
        backgroundColor: c.accent,
        borderRadius: theme.radius,
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    addText: { color: c.accentInk, fontSize: 13, fontWeight: "700" },
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    rowMain: { flex: 1 },
    rowName: { color: c.ink, fontSize: 15, fontWeight: "600" },
    rowSub: { color: c.muted, fontSize: 13, marginTop: 1 },
    rowRight: { alignItems: "flex-end", gap: 4 },
    time: { color: c.muted, fontSize: 12 },
    unread: {
        minWidth: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: c.accent,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 5,
    },
    unreadText: { color: c.accentInk, fontSize: 11, fontWeight: "700" },
    muted: { color: c.muted, fontSize: 14 },
    error: { color: c.danFg, fontSize: 13, marginTop: 6 },
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
    closeText: { color: c.accent, fontSize: 14, fontWeight: "600" },
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
    composerInput: {
        flex: 1,
        backgroundColor: c.bg,
        borderColor: c.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        paddingHorizontal: 12,
        paddingVertical: 9,
        color: c.ink,
        fontSize: 15,
        maxHeight: 110,
    },
    sendBtn: {
        backgroundColor: c.accent,
        borderRadius: theme.radius,
        paddingHorizontal: 16,
        paddingVertical: 11,
    },
    sendText: { color: c.accentInk, fontSize: 14, fontWeight: "700" },
    formBody: { paddingVertical: 12, gap: 2 },
    center: { alignItems: "center", gap: 12, paddingVertical: 20 },
    fieldLabel: { color: c.inkSoft, fontSize: 13, fontWeight: "600", marginBottom: 6 },
    fieldSpace: { marginTop: 14 },
    input: {
        backgroundColor: c.bg,
        borderColor: c.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: c.ink,
        fontSize: 15,
    },
    textArea: {
        backgroundColor: c.bg,
        borderColor: c.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: c.ink,
        fontSize: 15,
        minHeight: 90,
        textAlignVertical: "top",
    },
    chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
        borderColor: c.border,
        borderWidth: theme.borderWidth,
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    chipOn: { backgroundColor: c.accentWeak, borderColor: c.accent },
    chipText: { color: c.inkSoft, fontSize: 13, fontWeight: "600" },
    chipTextOn: { color: c.accentStrong },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 8 },
    cancel: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: theme.radius },
    cancelText: { color: c.inkSoft, fontSize: 14, fontWeight: "600" },
    save: {
        backgroundColor: c.accent,
        borderRadius: theme.radius,
        paddingHorizontal: 16,
        paddingVertical: 10,
        minWidth: 96,
        alignItems: "center",
    },
    saveText: { color: c.accentInk, fontSize: 14, fontWeight: "700" },
    btnBusy: { opacity: 0.6 },
});
