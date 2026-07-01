import {
    type BroadcastResult,
    type Channel,
    MESSAGE_CHANNELS,
    type MessageRow,
    type ThreadRow,
    channelLabel,
    formatRelativeTime,
    formatTime,
    markThreadRead,
    messageStatusIntent,
    parseTimestamp,
    useBroadcastForm,
    useClients,
    useComposeMessage,
    useThreadMessages,
    useThreads,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useEffect, useState } from "react";
import {
    FlatList,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";

const c = theme.colors;
export function InboxScreen() {
    const threads = useThreads();
    const [openId, setOpenId] = useState<string | null>(null);
    const [composing, setComposing] = useState(false);
    const [broadcasting, setBroadcasting] = useState(false);
    const open = threads.find((t) => t.id === openId) ?? null;

    return (
        <SafeAreaView style={styles.screen} edges={["top"]}>
            <View style={styles.header}>
                <Text style={styles.title}>Inbox</Text>
                <View style={styles.headerBtns}>
                    <Pressable
                        style={styles.ghostBtn}
                        onPress={() => {
                            setBroadcasting(true);
                        }}
                    >
                        <Text style={styles.ghostText}>Broadcast</Text>
                    </Pressable>
                    <Pressable
                        style={styles.add}
                        onPress={() => {
                            setComposing(true);
                        }}
                    >
                        <Text style={styles.addText}>New</Text>
                    </Pressable>
                </View>
            </View>

            <FlatList
                data={threads}
                keyExtractor={(t) => t.id}
                contentContainerStyle={styles.list}
                renderItem={({ item }) => (
                    <ThreadRowView
                        thread={item}
                        onPress={() => {
                            setOpenId(item.id);
                        }}
                    />
                )}
                ListEmptyComponent={<Text style={styles.empty}>No conversations yet.</Text>}
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
        </SafeAreaView>
    );
}

function ThreadRowView({ thread, onPress }: { thread: ThreadRow; onPress: () => void }) {
    return (
        <Pressable style={styles.row} onPress={onPress}>
            <View style={styles.rowMain}>
                <Text style={styles.rowName} numberOfLines={1}>
                    {thread.client_name ?? "Client"}
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
        </Pressable>
    );
}

function ThreadModal({ thread, onClose }: { thread: ThreadRow | null; onClose: () => void }) {
    return (
        <Modal visible={thread !== null} animationType="slide" transparent onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <View style={styles.sheet}>
                    {thread !== null ? <ThreadBody thread={thread} onClose={onClose} /> : null}
                </View>
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

    useEffect(() => {
        if (thread.unread_count > 0) void markThreadRead(api, thread.id);
    }, [thread.id, thread.unread_count]);

    return (
        <KeyboardAvoidingView
            style={styles.threadFill}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
            <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle} numberOfLines={1}>
                    {thread.client_name ?? "Client"}
                </Text>
                <Pressable onPress={onClose}>
                    <Text style={styles.closeText}>Close</Text>
                </Pressable>
            </View>

            <FlatList
                data={messages}
                keyExtractor={(m) => m.id}
                contentContainerStyle={styles.messages}
                renderItem={({ item }) => <Bubble message={item} />}
                ListEmptyComponent={<Text style={styles.muted}>No messages yet.</Text>}
            />

            <View style={styles.composer}>
                {compose.error !== null ? <Text style={styles.error}>{compose.error}</Text> : null}
                <View style={styles.composerRow}>
                    <TextInput
                        style={styles.composerInput}
                        value={compose.body}
                        onChangeText={compose.setBody}
                        placeholder={`Reply by ${channelLabel(thread.channel).toLowerCase()}…`}
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
                        <Text style={styles.sendText}>{compose.busy ? "…" : "Send"}</Text>
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
                    <StatusBadge
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
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <View style={styles.formSheet}>
                    <Text style={styles.sheetTitle}>New message</Text>
                    <ScrollView contentContainerStyle={styles.formBody}>
                        <Text style={styles.fieldLabel}>Client</Text>
                        {clients.length === 0 ? (
                            <Text style={styles.muted}>Add a client first.</Text>
                        ) : (
                            <View style={styles.chipWrap}>
                                {clients.map((cl) => (
                                    <Pressable
                                        key={cl.id}
                                        style={[
                                            styles.chip,
                                            compose.clientId === cl.id && styles.chipOn,
                                        ]}
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

                        <Text style={[styles.fieldLabel, styles.fieldSpace]}>Channel</Text>
                        <ChannelToggle value={compose.channel} onChange={compose.setChannel} />

                        <Text style={[styles.fieldLabel, styles.fieldSpace]}>Message</Text>
                        <TextInput
                            style={styles.textArea}
                            value={compose.body}
                            onChangeText={compose.setBody}
                            placeholder="Write a message…"
                            placeholderTextColor={c.muted}
                            multiline
                        />
                        {compose.error !== null ? (
                            <Text style={styles.error}>{compose.error}</Text>
                        ) : null}
                    </ScrollView>
                    <ModalActions
                        busy={compose.busy}
                        onCancel={onClose}
                        onSubmit={compose.submit}
                        label="Send"
                    />
                </View>
            </View>
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
        <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
            <View style={styles.backdrop}>
                <View style={styles.formSheet}>
                    {sent !== null ? (
                        <View style={styles.center}>
                            <Text style={styles.sheetTitle}>
                                {sent.status === "scheduled"
                                    ? "Broadcast scheduled"
                                    : "Broadcast sent"}
                            </Text>
                            <Text style={styles.muted}>
                                {sent.name} · {sent.recipient_count} recipient
                                {sent.recipient_count === 1 ? "" : "s"}
                            </Text>
                            <Pressable style={styles.add} onPress={close}>
                                <Text style={styles.addText}>Done</Text>
                            </Pressable>
                        </View>
                    ) : (
                        <>
                            <Text style={styles.sheetTitle}>New broadcast</Text>
                            <ScrollView contentContainerStyle={styles.formBody}>
                                <Text style={styles.fieldLabel}>Name</Text>
                                <TextInput
                                    style={styles.input}
                                    value={form.name}
                                    onChangeText={form.setName}
                                    placeholder="Spring promo"
                                    placeholderTextColor={c.muted}
                                />
                                <Text style={[styles.fieldLabel, styles.fieldSpace]}>Channel</Text>
                                <ChannelToggle value={form.channel} onChange={form.setChannel} />
                                <Text style={[styles.fieldLabel, styles.fieldSpace]}>Message</Text>
                                <TextInput
                                    style={styles.textArea}
                                    value={form.body}
                                    onChangeText={form.setBody}
                                    placeholder="Write your announcement…"
                                    placeholderTextColor={c.muted}
                                    multiline
                                />
                                <Text style={[styles.fieldLabel, styles.fieldSpace]}>
                                    Audience tags (optional)
                                </Text>
                                <TextInput
                                    style={styles.input}
                                    value={form.tags}
                                    onChangeText={form.setTags}
                                    placeholder="vip, regulars — blank = everyone"
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
                                label="Send broadcast"
                            />
                        </>
                    )}
                </View>
            </View>
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
                <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
                style={[styles.save, busy && styles.btnBusy]}
                disabled={busy}
                onPress={onSubmit}
            >
                <Text style={styles.saveText}>{busy ? "Sending…" : label}</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 12,
    },
    title: { color: c.ink, fontSize: 26, fontWeight: "700", letterSpacing: -0.4 },
    headerBtns: { flexDirection: "row", alignItems: "center", gap: 8 },
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
    list: { paddingHorizontal: 20, paddingBottom: 24 },
    row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 13,
        borderBottomColor: c.border,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
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
    empty: { color: c.muted, textAlign: "center", paddingVertical: 48, fontSize: 14 },
    muted: { color: c.muted, fontSize: 14 },
    error: { color: c.danFg, fontSize: 13, marginTop: 6 },
    backdrop: { flex: 1, backgroundColor: c.scrim, justifyContent: "flex-end" },
    sheet: {
        backgroundColor: c.surface,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        height: "82%",
        overflow: "hidden",
    },
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
    formSheet: {
        backgroundColor: c.surface,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        maxHeight: "86%",
        padding: 20,
        paddingBottom: 32,
    },
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
