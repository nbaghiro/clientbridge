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
import { Button, ListPage, Notice, Select, StatusPill, TextField } from "@clientbridge/ui";
import { useState } from "react";

import { api } from "../lib/api";

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
        <div className="max-w-3xl">
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
                        <SummaryHeader summary={summary} />
                        {awaiting > 0 ? (
                            <p className="mt-2 text-sm text-muted">
                                {strings.reviews.awaitingCount(awaiting)}
                            </p>
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
        </div>
    );
}

function SummaryHeader({ summary }: { summary: ReturnType<typeof useReviewSummary> }) {
    return (
        <div className="mt-6 flex items-center gap-4 rounded-lg border border-line bg-surface px-5 py-4 shadow-card">
            {summary === null ? (
                <p className="text-sm text-muted">{strings.reviews.loadingRating}</p>
            ) : summary === "error" ? (
                <Notice tone="danger">{strings.reviews.ratingLoadError}</Notice>
            ) : summary.count === 0 ? (
                <p className="text-sm text-muted">{strings.reviews.noPublishedReviews}</p>
            ) : (
                <>
                    <div className="flex items-baseline gap-1">
                        <span className="font-display text-4xl font-bold tabular-nums text-ink">
                            {formatAverageRating(summary.average)}
                        </span>
                        <Stars rating={roundedRating(summary.average)} />
                    </div>
                    <p className="text-sm text-muted">
                        {strings.reviews.publishedCount(summary.count)}
                    </p>
                </>
            )}
        </div>
    );
}

function Stars({ rating }: { rating: number }) {
    return (
        <span aria-label={strings.reviews.ratingOutOf(rating)} className="text-lg text-accent">
            {"★".repeat(rating)}
            <span className="text-line">{"★".repeat(emptyStars(rating))}</span>
        </span>
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
        <div>
            <div className="flex items-center gap-3">
                <Stars rating={review.rating} />
                <span className="text-sm font-medium text-ink">
                    {review.client_name ?? strings.reviews.clientFallback}
                </span>
                <span className="text-xs text-muted">{formatRelativeTime(review.created_at)}</span>
                <span className="ml-auto">
                    <StatusPill status={review.status} intent={reviewStatusIntent(review.status)} />
                </span>
            </div>

            {review.body !== null ? (
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{review.body}</p>
            ) : null}

            {review.response !== null && !editing ? (
                <div className="mt-3 rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink-soft">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                        {strings.reviews.yourReply}
                    </p>
                    <p className="mt-1 leading-relaxed">{review.response}</p>
                </div>
            ) : null}

            {editing ? (
                <div className="mt-3 space-y-2">
                    <TextField
                        multiline
                        rows={3}
                        value={reply}
                        onChange={setReply}
                        placeholder={strings.reviews.replyPlaceholder}
                    />
                    <div className="flex justify-end gap-2">
                        <Button
                            variant="quiet"
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
                    </div>
                </div>
            ) : (
                <div className="mt-3 flex items-center gap-2">
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
                </div>
            )}

            {error !== null ? <Notice tone="danger">{error}</Notice> : null}
        </div>
    );
}

function RequestReview({ onClose }: { onClose: () => void }) {
    const form = useRequestReviewForm(api, onClose);
    const clients = useClients();

    return (
        <section className="mt-5 rounded-lg border border-line bg-surface p-5 shadow-card">
            <h2 className="mb-3 font-display text-base font-bold text-ink">
                {strings.reviews.requestTitle}
            </h2>
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    form.submit();
                }}
                className="space-y-3"
            >
                <Select
                    label={strings.reviews.clientLabel}
                    value={form.clientId}
                    options={[
                        { key: "", label: strings.reviews.selectClient },
                        ...clients.map((cl) => ({ key: cl.id, label: cl.name })),
                    ]}
                    onChange={form.setClientId}
                />
                {form.error !== null ? <Notice tone="danger">{form.error}</Notice> : null}
                <div className="flex justify-end gap-2">
                    <Button variant="quiet" onPress={onClose}>
                        {strings.common.cancel}
                    </Button>
                    <Button submit busy={form.busy}>
                        {form.busy ? strings.reviews.sending : strings.reviews.sendRequest}
                    </Button>
                </div>
            </form>
        </section>
    );
}
