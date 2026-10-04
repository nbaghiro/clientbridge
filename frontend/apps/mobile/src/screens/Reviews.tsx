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
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { StatusPill } from "../ui/StatusPill";
import { api } from "../lib/api";
import { ListPage } from "../ui/ListPage";

const c = theme.colors;

export function ReviewsScreen() {
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
                            <Text style={styles.error}>{strings.reviews.ratingLoadError}</Text>
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
                    <TextInput
                        value={reply}
                        onChangeText={setReply}
                        placeholder={strings.reviews.replyPlaceholder}
                        placeholderTextColor={c.muted}
                        multiline
                        style={styles.input}
                    />
                    <View style={styles.actions}>
                        <Pressable
                            style={styles.secondaryBtn}
                            onPress={() => {
                                setReply(review.response ?? "");
                                setEditing(false);
                            }}
                        >
                            <Text style={styles.secondaryText}>{strings.common.cancel}</Text>
                        </Pressable>
                        <Pressable
                            style={[styles.primaryBtn, busy && styles.btnBusy]}
                            disabled={busy || reply.trim().length === 0}
                            onPress={() => {
                                respond(reply);
                                setEditing(false);
                            }}
                        >
                            <Text style={styles.primaryText}>
                                {busy ? strings.common.saving : strings.reviews.postReply}
                            </Text>
                        </Pressable>
                    </View>
                </View>
            ) : (
                <View style={styles.actions}>
                    <Pressable
                        style={styles.secondaryBtn}
                        onPress={() => {
                            setEditing(true);
                        }}
                    >
                        <Text style={styles.secondaryText}>
                            {review.response !== null
                                ? strings.reviews.editReply
                                : strings.reviews.reply}
                        </Text>
                    </Pressable>
                    {canPublish ? (
                        <Pressable
                            style={[styles.primaryBtn, busy && styles.btnBusy]}
                            disabled={busy}
                            onPress={publish}
                        >
                            <Text style={styles.primaryText}>
                                {busy ? strings.common.working : strings.reviews.publish}
                            </Text>
                        </Pressable>
                    ) : null}
                    {canHide ? (
                        <Pressable
                            style={[styles.secondaryBtn, busy && styles.btnBusy]}
                            disabled={busy}
                            onPress={hide}
                        >
                            <Text style={styles.secondaryText}>
                                {busy ? strings.common.working : strings.reviews.hide}
                            </Text>
                        </Pressable>
                    ) : null}
                </View>
            )}

            {error !== null ? <Text style={styles.error}>{error}</Text> : null}
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
                <View style={styles.chipWrap}>
                    {clients.map((cl) => (
                        <Pressable
                            key={cl.id}
                            style={[styles.chip, form.clientId === cl.id && styles.chipOn]}
                            onPress={() => {
                                form.setClientId(cl.id);
                            }}
                        >
                            <Text
                                style={[
                                    styles.chipText,
                                    form.clientId === cl.id && styles.chipTextOn,
                                ]}
                            >
                                {cl.name}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            )}
            {form.error !== null ? <Text style={styles.error}>{form.error}</Text> : null}
            <Pressable
                style={[styles.primaryBtn, styles.panelBtn, form.busy && styles.btnBusy]}
                disabled={form.busy}
                onPress={form.submit}
            >
                <Text style={styles.primaryText}>
                    {form.busy ? strings.reviews.sending : strings.reviews.sendRequest}
                </Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    muted: { color: c.muted, fontSize: 14 },
    error: { color: c.danFg, fontSize: 13, marginTop: 6 },
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
    input: {
        backgroundColor: c.bg,
        borderColor: c.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: c.ink,
        fontSize: 14,
        minHeight: 64,
        textAlignVertical: "top",
    },
    actions: { flexDirection: "row", gap: 8, alignItems: "center" },
    primaryBtn: {
        backgroundColor: c.accent,
        borderRadius: theme.radius,
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    primaryText: { color: c.accentInk, fontSize: 13, fontWeight: "700" },
    secondaryBtn: {
        borderColor: c.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    secondaryText: { color: c.inkSoft, fontSize: 13, fontWeight: "700" },
    btnBusy: { opacity: 0.6 },
    panel: {
        backgroundColor: c.surface,
        borderColor: c.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        padding: 14,
        gap: 10,
    },
    panelTitle: { color: c.ink, fontSize: 15, fontWeight: "700" },
    panelBtn: { alignSelf: "flex-start" },
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
});
