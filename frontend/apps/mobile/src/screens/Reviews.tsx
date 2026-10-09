import {
    type ReviewQueue,
    type ReviewRow,
    firstName,
    formatAverageRating,
    formatDate,
    parseTimestamp,
    reviewVisitLine,
    roundedRating,
    strings,
    suggestedReply,
    useModeratedReview,
    useRequestReview,
    useReviewQueue,
    useReviewSettings,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/native";
import {
    Avatar,
    Badge,
    Button,
    Empty,
    Modal,
    Notice,
    RatingDistribution,
    Select,
    Stars,
    StatusPill,
    TextField,
    Toggle,
} from "@clientbridge/ui";
import { useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";

import { Loaded } from "../components/Loaded";
import { api } from "../lib/api";
import { useOpenLink } from "../lib/links";

const c = theme.colors;
const s = strings.reviews;

const dateOf = (value: string): string => formatDate(parseTimestamp(value));

const openExternal = (url: string): void => {
    Linking.openURL(url).catch(() => undefined);
};

export function Reviews() {
    const queue = useReviewQueue();
    const [asking, setAsking] = useState(false);
    const ask = (): void => {
        setAsking(true);
    };
    return (
        <View style={styles.screen}>
            <ScrollView contentContainerStyle={styles.body}>
                <View style={styles.top}>
                    <Text style={styles.subtitle}>{s.subtitle}</Text>
                    <Button style={{ alignSelf: "center" }} size="sm" icon="send" onPress={ask}>
                        {s.ask}
                    </Button>
                </View>
                <Loaded load={queue.load} loading={s.loading} failed={s.loadError}>
                    {queue.load.state === "empty" ? (
                        <Empty
                            variant="card"
                            icon="star"
                            message={s.noReviewsTitle}
                            body={s.noReviewsBody}
                            actions={<Button onPress={ask}>{s.requestReview}</Button>}
                        />
                    ) : (
                        <>
                            <ReviewSummary queue={queue} />
                            <View style={styles.sectionHead}>
                                <Text style={styles.sectionTitle}>{s.heldTitle}</Text>
                                {queue.held.length > 0 ? (
                                    <Badge
                                        style={{ alignSelf: "center" }}
                                        label={queue.held.length}
                                        intent="warning"
                                    />
                                ) : null}
                            </View>
                            {queue.held.length === 0 ? (
                                <Empty message={s.heldEmpty} />
                            ) : (
                                queue.held.map((r) => (
                                    <ReviewCard key={r.id} review={r} queue={queue} />
                                ))
                            )}
                            <AskList queue={queue} />
                            <Text style={[styles.sectionTitle, styles.sectionHead]}>
                                {s.publishedTitle}
                            </Text>
                            {queue.published.length === 0 ? (
                                <Empty message={s.noPublished} />
                            ) : (
                                queue.published.map((r) => (
                                    <ReviewCard key={r.id} review={r} queue={queue} />
                                ))
                            )}
                            {queue.hidden.length > 0 ? (
                                <>
                                    <Text style={[styles.sectionTitle, styles.sectionHead]}>
                                        {s.hiddenTitle}
                                    </Text>
                                    {queue.hidden.map((r) => (
                                        <ReviewCard key={r.id} review={r} queue={queue} />
                                    ))}
                                </>
                            ) : null}
                        </>
                    )}
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

function ReviewSummary({ queue }: { queue: ReviewQueue }) {
    const settings = useReviewSettings(api, queue);
    return (
        <View style={styles.card}>
            {queue.count > 0 ? (
                <View style={styles.summaryRow}>
                    <View>
                        <Text style={styles.avg}>{formatAverageRating(queue.average)}</Text>
                        <Stars value={roundedRating(queue.average)} size="sm" />
                    </View>
                    <View style={styles.flex}>
                        <RatingDistribution rows={queue.distribution} label={s.distributionRow} />
                    </View>
                </View>
            ) : null}
            <Text style={styles.meta}>{s.reviewCount(queue.count)}</Text>
            <View style={styles.divider}>
                <Toggle
                    label={s.holdToggle}
                    hint={s.holdHint}
                    value={settings.holdLow}
                    onChange={settings.setHoldLow}
                />
                <TextField
                    label={s.googleUrl}
                    hint={settings.googleUrl === "" ? s.shareNeedsLink : s.googleUrlHint}
                    value={settings.googleUrl}
                    onChange={settings.setGoogleUrl}
                    placeholder={s.googleUrlPlaceholder}
                    type="url"
                />
                <View style={styles.buttons}>
                    <Button
                        style={{ alignSelf: "center" }}
                        size="sm"
                        variant="outline"
                        busy={settings.busy}
                        onPress={settings.saveGoogleUrl}
                    >
                        {s.saveLink}
                    </Button>
                    {settings.savedGoogle ? <Text style={styles.meta}>{s.linkSaved}</Text> : null}
                </View>
                {settings.error !== null ? <Notice tone="danger">{settings.error}</Notice> : null}
            </View>
        </View>
    );
}

function ReplyEditor({
    review,
    busy,
    onPost,
    onCancel,
}: {
    review: ReviewRow;
    busy: boolean;
    onPost: (text: string) => void;
    onCancel: () => void;
}) {
    const [text, setText] = useState(review.response ?? "");
    const suggestion = review.response === null ? suggestedReply(review) : null;
    return (
        <View style={styles.editor}>
            {suggestion !== null && text.length === 0 ? (
                <View style={styles.suggestion}>
                    <Text style={styles.suggestionLabel}>{s.suggestedReply}</Text>
                    <Text style={styles.suggestionText}>{suggestion}</Text>
                    <Button
                        size="sm"
                        variant="link"
                        onPress={() => {
                            setText(suggestion);
                        }}
                    >
                        {s.useSuggestion}
                    </Button>
                </View>
            ) : null}
            <TextField
                label={s.yourReply}
                multiline
                rows={3}
                value={text}
                onChange={setText}
                placeholder={s.replyPlaceholder}
            />
            <View style={styles.actions}>
                <Button size="sm" variant="quiet" onPress={onCancel}>
                    {s.cancel}
                </Button>
                <Button
                    size="sm"
                    busy={busy}
                    disabled={text.trim().length === 0}
                    onPress={() => {
                        onPost(text);
                    }}
                >
                    {s.postReply}
                </Button>
            </View>
        </View>
    );
}

function ReviewCard({ review, queue }: { review: ReviewRow; queue: ReviewQueue }) {
    const m = useModeratedReview(api, review, openExternal);
    const openLink = useOpenLink();
    const [replying, setReplying] = useState(false);
    const name = review.client_name ?? s.clientFallback;
    return (
        <View style={[styles.card, m.held && styles.held]}>
            <View style={styles.head}>
                <Avatar name={name} />
                <View style={styles.flex}>
                    <Text style={styles.name} numberOfLines={1}>
                        {name}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1}>
                        {reviewVisitLine(review)}
                    </Text>
                </View>
                {review.sent_to_google === 1 ? (
                    <Badge
                        style={{ alignSelf: "center" }}
                        label={s.sharedGoogle}
                        intent="neutral"
                    />
                ) : null}
            </View>
            <View style={styles.starsRow}>
                <Stars value={review.rating} size="sm" />
                {review.status === "hidden" ? (
                    <StatusPill
                        style={{ alignSelf: "center" }}
                        status={s.state.hidden}
                        intent="neutral"
                        asWritten
                    />
                ) : null}
            </View>
            <Text style={[styles.text, review.body === null && styles.noComment]}>
                {review.body ?? s.noComment}
            </Text>
            {review.response !== null && !replying ? (
                <View style={styles.reply}>
                    <Text style={styles.replyLabel}>
                        {s.replied(dateOf(review.responded_at ?? review.created_at))}
                    </Text>
                    <Text style={styles.replyText}>{review.response}</Text>
                </View>
            ) : null}
            {replying ? (
                <ReplyEditor
                    review={review}
                    busy={m.busy}
                    onPost={(t) => {
                        m.respond(t);
                        setReplying(false);
                    }}
                    onCancel={() => {
                        setReplying(false);
                    }}
                />
            ) : (
                <View style={styles.buttons}>
                    {m.held || review.status === "hidden" ? (
                        <Button
                            style={{ alignSelf: "center" }}
                            size="sm"
                            busy={m.busy}
                            onPress={m.publish}
                        >
                            {s.publish}
                        </Button>
                    ) : null}
                    <Button
                        style={{ alignSelf: "center" }}
                        size="sm"
                        variant="outline"
                        onPress={() => {
                            setReplying(true);
                        }}
                    >
                        {review.response === null ? s.reply : s.editReply}
                    </Button>
                    {m.canShare ? (
                        <Button
                            style={{ alignSelf: "center" }}
                            size="sm"
                            variant="outline"
                            busy={m.busy}
                            disabled={queue.googleUrl === null}
                            onPress={m.share}
                        >
                            {s.shareGoogle}
                        </Button>
                    ) : null}
                    {m.held ? (
                        <Button
                            style={{ alignSelf: "center" }}
                            size="sm"
                            variant="outline"
                            label={s.messageClient(firstName(name))}
                            onPress={() => {
                                openLink("message", review.client_id);
                            }}
                        >
                            {s.messageShort}
                        </Button>
                    ) : null}
                    {review.status !== "hidden" ? (
                        <Button
                            style={{ alignSelf: "center" }}
                            size="sm"
                            variant="quiet"
                            busy={m.busy}
                            onPress={m.hide}
                        >
                            {s.hide}
                        </Button>
                    ) : null}
                </View>
            )}
            {m.error !== null ? <Notice tone="danger">{m.error}</Notice> : null}
        </View>
    );
}

function AskList({ queue }: { queue: ReviewQueue }) {
    const req = useRequestReview(api);
    return (
        <View style={styles.card}>
            <Text style={styles.section}>{s.askTitle}</Text>
            <Text style={styles.meta}>{s.askSubtitle}</Text>
            {queue.suggestions.length === 0 ? <Text style={styles.meta}>{s.askEmpty}</Text> : null}
            {queue.suggestions.map((x) => (
                <View key={x.clientId} style={styles.row}>
                    <Avatar name={x.clientName} size="sm" />
                    <View style={styles.flex}>
                        <Text style={styles.rowName}>{x.clientName}</Text>
                        <Text style={styles.meta}>{x.visit}</Text>
                    </View>
                    {req.sent.has(x.clientId) ? (
                        <Badge style={{ alignSelf: "center" }} label={s.asked} intent="success" />
                    ) : (
                        <Button
                            style={{ alignSelf: "center" }}
                            size="sm"
                            variant="outline"
                            busy={req.busyId === x.clientId}
                            onPress={() => {
                                req.request(x.clientId);
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
                        <Text style={styles.meta}>{s.requestedOn(dateOf(r.requested_at))}</Text>
                    </View>
                    <StatusPill
                        style={{ alignSelf: "center" }}
                        status={s.requestState[r.status] ?? r.status}
                        intent={r.status === "opened" ? "accent" : "neutral"}
                        asWritten
                    />
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
                            disabled={clientId === "" || sent}
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
    top: { flexDirection: "row", alignItems: "center", gap: 12 },
    subtitle: { flex: 1, color: c.muted, fontSize: 13 },
    sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
    sectionTitle: { color: c.ink, fontSize: 18, fontWeight: "700" },
    sheet: { gap: 14 },
    sheetTitle: { color: c.ink, fontSize: 18, fontWeight: "700" },
    sheetBody: { color: c.inkSoft, fontSize: 14, lineHeight: 20 },
    sheetActions: { flexDirection: "row", gap: 10 },
    flex: { flex: 1, minWidth: 0 },
    card: {
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: theme.radius,
        padding: 14,
        gap: 10,
    },
    held: { borderColor: c.warnFg },
    summaryRow: { flexDirection: "row", gap: 16, alignItems: "center" },
    avg: { color: c.ink, fontSize: 34, fontWeight: "700" },
    divider: {
        borderTopColor: c.border,
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingTop: 10,
        gap: 12,
    },
    head: { flexDirection: "row", alignItems: "center", gap: 10 },
    name: { color: c.ink, fontSize: 16, fontWeight: "700" },
    meta: { color: c.muted, fontSize: 12, marginTop: 2 },
    starsRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    text: { color: c.ink, fontSize: 15, lineHeight: 21 },
    noComment: { color: c.muted, fontStyle: "italic" },
    reply: { borderLeftWidth: 2, borderLeftColor: c.accentLine, paddingLeft: 10 },
    replyLabel: { color: c.inkSoft, fontSize: 12, fontWeight: "600" },
    replyText: { color: c.inkSoft, fontSize: 14, lineHeight: 20, marginTop: 2 },
    buttons: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
    editor: { gap: 6 },
    suggestion: { backgroundColor: c.accentWeak, borderRadius: theme.radius, padding: 10, gap: 4 },
    suggestionLabel: { color: c.accentStrong, fontSize: 12, fontWeight: "700" },
    suggestionText: { color: c.inkSoft, fontSize: 14, lineHeight: 20 },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 6 },
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
});
