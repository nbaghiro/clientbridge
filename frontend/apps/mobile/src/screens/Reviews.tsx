import {
    type ReviewRow,
    canManagePayments,
    emptyStars,
    formatAverageRating,
    formatRelativeTime,
    reviewStatusIntent,
    roundedRating,
    useClients,
    useRequestReviewForm,
    useReviewActions,
    useReviewSummary,
    useReviews,
} from "@clientbridge/app-core";
import { theme } from "@clientbridge/tokens/theme";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";

const c = theme.colors;

export function ReviewsScreen() {
    const role = useRole();

    if (!canManagePayments(role)) {
        return (
            <View style={[styles.screen, styles.center]}>
                <Text style={styles.muted}>Reviews are available to owners and admins.</Text>
            </View>
        );
    }
    return <ReviewsBody />;
}

function ReviewsBody() {
    const [reloadKey, setReloadKey] = useState(0);
    const summary = useReviewSummary(api, reloadKey);
    const reviews = useReviews();
    const [requesting, setRequesting] = useState(false);

    const refreshSummary = (): void => {
        setReloadKey((k) => k + 1);
    };

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <View style={styles.summary}>
                {summary === null ? (
                    <Text style={styles.muted}>Loading rating…</Text>
                ) : summary === "error" ? (
                    <Text style={styles.error}>Couldn't load your rating.</Text>
                ) : summary.count === 0 ? (
                    <Text style={styles.muted}>No published reviews yet.</Text>
                ) : (
                    <>
                        <Text style={styles.average}>{formatAverageRating(summary.average)}</Text>
                        <Stars rating={roundedRating(summary.average)} />
                        <Text style={styles.muted}>
                            {summary.count} published review{summary.count === 1 ? "" : "s"}
                        </Text>
                    </>
                )}
            </View>

            <Pressable
                style={styles.requestBtn}
                onPress={() => {
                    setRequesting((r) => !r);
                }}
            >
                <Text style={styles.requestText}>{requesting ? "Close" : "Request a review"}</Text>
            </Pressable>

            {requesting ? (
                <RequestReview
                    onClose={() => {
                        setRequesting(false);
                    }}
                />
            ) : null}

            {reviews.length === 0 ? (
                <Text style={styles.muted}>No reviews yet.</Text>
            ) : (
                reviews.map((review) => (
                    <ReviewItem key={review.id} review={review} onDone={refreshSummary} />
                ))
            )}
        </ScrollView>
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
                <Text style={styles.client}>{review.client_name ?? "Client"}</Text>
                <Text style={styles.time}>{formatRelativeTime(review.created_at)}</Text>
                <View style={styles.badge}>
                    <StatusBadge
                        status={review.status}
                        intent={reviewStatusIntent(review.status)}
                    />
                </View>
            </View>

            {review.body !== null ? <Text style={styles.body}>{review.body}</Text> : null}

            {review.response !== null && !editing ? (
                <View style={styles.reply}>
                    <Text style={styles.replyLabel}>Your reply</Text>
                    <Text style={styles.replyText}>{review.response}</Text>
                </View>
            ) : null}

            {editing ? (
                <View style={styles.editor}>
                    <TextInput
                        value={reply}
                        onChangeText={setReply}
                        placeholder="Write a public reply…"
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
                            <Text style={styles.secondaryText}>Cancel</Text>
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
                                {busy ? "Saving…" : "Post reply"}
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
                            {review.response !== null ? "Edit reply" : "Reply"}
                        </Text>
                    </Pressable>
                    {canPublish ? (
                        <Pressable
                            style={[styles.primaryBtn, busy && styles.btnBusy]}
                            disabled={busy}
                            onPress={publish}
                        >
                            <Text style={styles.primaryText}>{busy ? "Working…" : "Publish"}</Text>
                        </Pressable>
                    ) : null}
                    {canHide ? (
                        <Pressable
                            style={[styles.secondaryBtn, busy && styles.btnBusy]}
                            disabled={busy}
                            onPress={hide}
                        >
                            <Text style={styles.secondaryText}>{busy ? "Working…" : "Hide"}</Text>
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
            <Text style={styles.panelTitle}>Request a review</Text>
            {clients.length === 0 ? (
                <Text style={styles.muted}>Add a client first.</Text>
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
                <Text style={styles.primaryText}>{form.busy ? "Sending…" : "Send request"}</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    center: { alignItems: "center", justifyContent: "center" },
    content: { padding: 16, gap: 12 },
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
    requestBtn: {
        alignSelf: "flex-start",
        backgroundColor: c.accent,
        borderRadius: theme.radius,
        paddingHorizontal: 16,
        paddingVertical: 9,
    },
    requestText: { color: c.accentInk, fontSize: 13, fontWeight: "700" },
    card: {
        backgroundColor: c.surface,
        borderColor: c.border,
        borderWidth: theme.borderWidth,
        borderRadius: theme.radius,
        padding: 14,
        gap: 8,
    },
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
