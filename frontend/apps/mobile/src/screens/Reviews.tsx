import {
    type ReviewQueue,
    formatDate,
    parseTimestamp,
    strings,
    useRequestReview,
    useReviewQueue,
    useReviewSettings,
    useBusinessZone,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import { Avatar, Badge, Button, Modal, Notice, Select, TextField } from "@clientbridge/ui";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Loaded } from "../components/Loaded";
import { api } from "../lib/api";
const c = theme.colors;
const s = strings.reviews;
const dateOf = (value: string, zone: string): string => formatDate(parseTimestamp(value), zone);

export function Reviews() {
    const queue = useReviewQueue();
    const settings = useReviewSettings(api, queue);
    const [asking, setAsking] = useState(false);
    return (
        <View style={styles.screen}>
            <ScrollView contentContainerStyle={styles.body}>
                <Text style={styles.subtitle}>{s.subtitle}</Text>
                <Loaded load={queue.load} loading={s.loading} failed={s.loadError}>
                    <View style={styles.card}>
                        <TextField
                            label={s.googleUrl}
                            hint={s.googleUrlHint}
                            value={settings.googleUrl}
                            onChange={settings.setGoogleUrl}
                            placeholder={s.googleUrlPlaceholder}
                            type="url"
                        />
                        <Button size="sm" busy={settings.busy} onPress={settings.saveGoogleUrl}>
                            {s.saveLink}
                        </Button>
                        {settings.savedGoogle ? (
                            <Notice tone="success">{s.linkSaved}</Notice>
                        ) : null}
                        {settings.error !== null ? (
                            <Notice tone="danger">{settings.error}</Notice>
                        ) : null}
                    </View>
                    {queue.googleUrl === null ? (
                        <Notice tone="info">{s.linkRequired}</Notice>
                    ) : null}
                    <Button
                        icon="send"
                        disabled={queue.googleUrl === null}
                        onPress={() => {
                            setAsking(true);
                        }}
                    >
                        {s.requestReview}
                    </Button>
                    <AskList queue={queue} />
                </Loaded>
            </ScrollView>
            {asking ? (
                <RequestReviewSheet
                    queue={queue}
                    onClose={() => {
                        setAsking(false);
                    }}
                />
            ) : null}
        </View>
    );
}

function AskList({ queue }: { queue: ReviewQueue }) {
    const zone = useBusinessZone();
    const req = useRequestReview(api);
    return (
        <View style={styles.card}>
            <Text style={styles.section}>{s.askTitle}</Text>
            <Text style={styles.meta}>{s.askSubtitle}</Text>
            {queue.suggestions.length === 0 ? <Text style={styles.meta}>{s.askEmpty}</Text> : null}
            {queue.suggestions.map((x) => (
                <View key={x.bookingId} style={styles.row}>
                    <Avatar name={x.clientName} size="sm" />
                    <View style={styles.flex}>
                        <Text style={styles.rowName}>{x.clientName}</Text>
                        <Text style={styles.meta}>{x.visit}</Text>
                    </View>
                    {req.sent.has(x.bookingId) ? (
                        <Badge style={{ alignSelf: "center" }} label={s.asked} intent="success" />
                    ) : (
                        <Button
                            style={{ alignSelf: "center" }}
                            size="sm"
                            variant="outline"
                            busy={req.busyId === x.bookingId}
                            disabled={queue.googleUrl === null}
                            onPress={() => {
                                req.request(x.clientId, x.bookingId);
                            }}
                        >
                            {s.ask}
                        </Button>
                    )}
                </View>
            ))}
            <Text style={[styles.section, styles.sectionGap]}>{s.requestsTitle}</Text>
            {queue.requests.length === 0 ? <Text style={styles.meta}>{s.noRequests}</Text> : null}
            {queue.requests.map((r) => (
                <View key={r.id} style={styles.row}>
                    <Avatar name={r.client_name ?? s.clientFallback} size="sm" />
                    <View style={styles.flex}>
                        <Text style={styles.rowName}>{r.client_name ?? s.clientFallback}</Text>
                        <Text style={styles.meta}>
                            {s.requestedOn(dateOf(r.requested_at, zone))}
                        </Text>
                    </View>
                </View>
            ))}
            {req.error !== null ? <Notice tone="danger">{req.error}</Notice> : null}
        </View>
    );
}

function RequestReviewSheet({ queue, onClose }: { queue: ReviewQueue; onClose: () => void }) {
    const req = useRequestReview(api);
    const [clientId, setClientId] = useState(queue.suggestions[0]?.clientId ?? "");
    const name = queue.clientOptions.find((o) => o.key === clientId)?.label ?? "";
    const sent = clientId !== "" && req.sent.has(clientId);
    return (
        <Modal open onClose={onClose}>
            <View style={styles.sheet}>
                <Text style={styles.sheetTitle}>{s.requestTitle}</Text>
                <Text style={styles.sheetBody}>{s.requestBody}</Text>
                <Select
                    label={s.requestClient}
                    value={clientId}
                    options={[{ key: "", label: s.chooseClient }, ...queue.clientOptions]}
                    onChange={setClientId}
                />
                {sent ? <Notice tone="success">{s.requestSent(name)}</Notice> : null}
                {req.error !== null ? <Notice tone="danger">{req.error}</Notice> : null}
                <View style={styles.sheetActions}>
                    <View style={styles.flex}>
                        <Button full variant="outline" onPress={onClose}>
                            {sent ? s.done : s.cancel}
                        </Button>
                    </View>
                    <View style={styles.flex}>
                        <Button
                            full
                            disabled={clientId === "" || sent || queue.googleUrl === null}
                            busy={req.busyId === clientId}
                            onPress={() => {
                                req.request(clientId);
                            }}
                        >
                            {s.requestSend}
                        </Button>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, gap: 12 },
    subtitle: { color: c.muted, fontSize: 13 },
    card: {
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: theme.radius,
        padding: 14,
        gap: 10,
    },
    flex: { flex: 1, minWidth: 0 },
    meta: { color: c.muted, fontSize: 12, marginTop: 2 },
    section: {
        color: c.muted,
        fontSize: 11,
        fontWeight: "600",
        letterSpacing: 0.5,
        textTransform: "uppercase",
    },
    sectionGap: { marginTop: 8 },
    row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
    rowName: { color: c.ink, fontSize: 14, fontWeight: "600" },
    sheet: { gap: 14 },
    sheetTitle: { color: c.ink, fontSize: 18, fontWeight: "700" },
    sheetBody: { color: c.inkSoft, fontSize: 14, lineHeight: 20 },
    sheetActions: { flexDirection: "row", gap: 10 },
});
