import {
    type ReviewRow,
    emptyStars,
    formatAverageRating,
    formatRelativeTime,
    reviewStatusIntent,
    roundedRating,
    strings,
    useAwaitingReviews,
    useClients,
    useRequestReviewForm,
    useReviewActions,
    useReviewSummary,
    useReviews,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button, Choice, ListPage, Notice, StatusPill, TextField } from "@clientbridge/ui";

import { api } from "../lib/api";

const c = theme.colors;

export function Reviews() {
    const [reloadKey, setReloadKey] = useState(0);
    const summary = useReviewSummary(api, reloadKey);
    const reviews = useReviews();
    const awaiting = useAwaitingReviews();
    const [requesting, setRequesting] = useState(false);

    const refreshSummary = (): void => {
        setReloadKey((k) => k + 1);
    };

    return (
        <ListPage
            summary={strings.reviews.subtitle}
            action={{
                label: strings.reviews.requestReview,
                onPress: () => {
                    setRequesting((r) => !r);
                },
            }}
            banner={
                <>
                    <View style={styles.summary}>
                        {summary === null ? (
                            <Text style={styles.muted}>{strings.reviews.loadingRating}</Text>
                        ) : summary === "error" ? (
                            <Notice tone="danger">{strings.reviews.ratingLoadError}</Notice>
                        ) : summary.count === 0 ? (
                            <Text style={styles.muted}>{strings.reviews.noPublishedReviews}</Text>
                        ) : (
                            <>
                                <Text style={styles.average}>
                                    {formatAverageRating(summary.average)}
                                </Text>
                                <Stars rating={roundedRating(summary.average)} />
                                <Text style={styles.muted}>
                                    {strings.reviews.publishedCount(summary.count)}
                                </Text>
                            </>
                        )}
                    </View>
                    {awaiting > 0 ? (
                        <Text style={styles.muted}>{strings.reviews.awaitingCount(awaiting)}</Text>
                    ) : null}
                    {requesting ? (
                        <RequestReview
                            onClose={() => {
                                setRequesting(false);
                            }}
                        />
                    ) : null}
                </>
            }
            rows={reviews}
            rowKey={(review) => review.id}
            empty={strings.reviews.noReviews}
            renderRow={(review) => <ReviewItem review={review} onDone={refreshSummary} />}
        />
    );
}

function Stars({ rating }: { rating: number }) {
    return (
        <Text style={styles.stars}>
            {"★".repeat(rating)}
            <Text style={styles.starsEmpty}>{"★".repeat(emptyStars(rating))}</Text>
        </Text>
    );
}

function ReviewItem({ review, onDone }: { review: ReviewRow; onDone: () => void }) {
    const { busy, error, canPublish, canHide, respond, hide, publish } = useReviewActions(
        api,
        review,
        onDone,
    );
    const [reply, setReply] = useState(review.response ?? "");
    const [editing, setEditing] = useState(false);

    return (
        <View style={styles.card}>
            <View style={styles.cardTop}>
                <Stars rating={review.rating} />
                <Text style={styles.client}>
                    {review.client_name ?? strings.reviews.clientFallback}
                </Text>
                <Text style={styles.time}>{formatRelativeTime(review.created_at)}</Text>
                <View style={styles.badge}>
                    <StatusPill status={review.status} intent={reviewStatusIntent(review.status)} />
                </View>
            </View>

            {review.body !== null ? <Text style={styles.body}>{review.body}</Text> : null}

            {review.response !== null && !editing ? (
                <View style={styles.reply}>
                    <Text style={styles.replyLabel}>{strings.reviews.yourReply}</Text>
                    <Text style={styles.replyText}>{review.response}</Text>
                </View>
            ) : null}

            {editing ? (
                <View style={styles.editor}>
                    <TextField
                        multiline
                        value={reply}
                        onChange={setReply}
                        placeholder={strings.reviews.replyPlaceholder}
                    />
                    <View style={styles.actions}>
                        <Button
                            variant="outline"
                            size="sm"
                            onPress={() => {
                                setReply(review.response ?? "");
                                setEditing(false);
                            }}
                        >
                            {strings.common.cancel}
                        </Button>
                        <Button
                            size="sm"
                            busy={busy}
                            disabled={reply.trim().length === 0}
                            onPress={() => {
                                respond(reply);
                                setEditing(false);
                            }}
                        >
                            {busy ? strings.common.saving : strings.reviews.postReply}
                        </Button>
                    </View>
                </View>
            ) : (
                <View style={styles.actions}>
                    <Button
                        variant="outline"
                        size="sm"
                        onPress={() => {
                            setEditing(true);
                        }}
                    >
                        {review.response !== null
                            ? strings.reviews.editReply
                            : strings.reviews.reply}
                    </Button>
                    {canPublish ? (
                        <Button size="sm" disabled={busy} onPress={publish}>
                            {busy ? strings.common.working : strings.reviews.publish}
                        </Button>
                    ) : null}
                    {canHide ? (
                        <Button variant="outline" size="sm" disabled={busy} onPress={hide}>
                            {busy ? strings.common.working : strings.reviews.hide}
                        </Button>
                    ) : null}
                </View>
            )}

            {error !== null ? <Notice tone="danger">{error}</Notice> : null}
        </View>
    );
}

function RequestReview({ onClose }: { onClose: () => void }) {
    const form = useRequestReviewForm(api, onClose);
    const clients = useClients();

    return (
        <View style={styles.panel}>
            <Text style={styles.panelTitle}>{strings.reviews.requestTitle}</Text>
            {clients.length === 0 ? (
                <Text style={styles.muted}>{strings.reviews.addClientFirst}</Text>
            ) : (
                <Choice
                    label={strings.reviews.clientLabel}
                    options={clients.map((cl) => ({ key: cl.id, label: cl.name }))}
                    value={form.clientId}
                    onChange={form.setClientId}
                />
            )}
            {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
            <Button size="sm" busy={form.busy} onPress={form.submit}>
                {form.busy ? strings.reviews.sending : strings.reviews.sendRequest}
            </Button>
        </View>
    );
}

const styles = StyleSheet.create({
    muted: { color: c.muted, fontSize: 14 },
    summary: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: c.surface,
        borderColor: c.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    average: { color: c.ink, fontSize: 30, fontWeight: "800", fontVariant: ["tabular-nums"] },
    stars: { color: c.accent, fontSize: 16 },
    starsEmpty: { color: c.border },
    card: { gap: 8 },
    cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
    client: { color: c.ink, fontSize: 14, fontWeight: "600" },
    time: { color: c.muted, fontSize: 12 },
    badge: { marginLeft: "auto" },
    body: { color: c.inkSoft, fontSize: 14, lineHeight: 20 },
    reply: {
        backgroundColor: c.bg,
        borderColor: c.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    replyLabel: { color: c.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
    replyText: { color: c.inkSoft, fontSize: 14, marginTop: 2, lineHeight: 20 },
    editor: { gap: 8 },
    actions: { flexDirection: "row", gap: 8, alignItems: "center" },
    panel: {
        backgroundColor: c.surface,
        borderColor: c.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        padding: 14,
        gap: 10,
    },
    panelTitle: { color: c.ink, fontSize: 15, fontWeight: "700" },
});
