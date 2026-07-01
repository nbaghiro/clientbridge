import {
    type ReviewRow,
    canManagePayments,
    emptyStars,
    formatAverageRating,
    formatRelativeTime,
    reviewStatusIntent,
    roundedRating,
    strings,
    useClients,
    useRequestReviewForm,
    useReviewActions,
    useReviewSummary,
    useReviews,
} from "@clientbridge/app-core";
import { useState } from "react";

import { StatusPill } from "../components/StatusPill";
import { api } from "../lib/api";
import { useRole } from "../lib/auth";

const field =
    "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-accent";

export function Reviews() {
    const role = useRole();

    if (!canManagePayments(role)) {
        return (
            <div className="mx-auto max-w-3xl px-8 py-8">
                <h1 className="font-display text-2xl font-bold text-ink">
                    {strings.reviews.title}
                </h1>
                <p className="mt-0.5 text-sm text-muted">{strings.reviews.restricted}</p>
            </div>
        );
    }

    return <ReviewsView />;
}

function ReviewsView() {
    const [reloadKey, setReloadKey] = useState(0);
    const summary = useReviewSummary(api, reloadKey);
    const reviews = useReviews();
    const [requesting, setRequesting] = useState(false);

    const refreshSummary = (): void => {
        setReloadKey((k) => k + 1);
    };

    return (
        <div className="mx-auto max-w-3xl px-8 py-8">
            <header className="flex items-center justify-between gap-4">
                <div>
                    <h1 className="font-display text-2xl font-bold text-ink">
                        {strings.reviews.title}
                    </h1>
                    <p className="mt-0.5 text-sm text-muted">{strings.reviews.subtitle}</p>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        setRequesting((r) => !r);
                    }}
                    className="shrink-0 rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90"
                >
                    {strings.reviews.requestReview}
                </button>
            </header>

            <SummaryHeader summary={summary} />

            {requesting ? (
                <RequestReview
                    onClose={() => {
                        setRequesting(false);
                    }}
                />
            ) : null}

            {reviews.length === 0 ? (
                <p className="mt-8 text-center text-sm text-muted">{strings.reviews.noReviews}</p>
            ) : (
                <div className="mt-6 space-y-3">
                    {reviews.map((review) => (
                        <ReviewItem key={review.id} review={review} onDone={refreshSummary} />
                    ))}
                </div>
            )}
        </div>
    );
}

function SummaryHeader({ summary }: { summary: ReturnType<typeof useReviewSummary> }) {
    return (
        <div className="mt-6 flex items-center gap-4 rounded-lg border border-line bg-surface px-5 py-4 shadow-card">
            {summary === null ? (
                <p className="text-sm text-muted">{strings.reviews.loadingRating}</p>
            ) : summary === "error" ? (
                <p className="text-sm text-danger">{strings.reviews.ratingLoadError}</p>
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
        <span aria-label={`${rating} out of 5`} className="text-lg text-accent">
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
        <div className="rounded-lg border border-line bg-surface p-4 shadow-card">
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
                    <textarea
                        value={reply}
                        onChange={(e) => {
                            setReply(e.target.value);
                        }}
                        rows={3}
                        placeholder={strings.reviews.replyPlaceholder}
                        className={field}
                    />
                    <div className="flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                setReply(review.response ?? "");
                                setEditing(false);
                            }}
                            className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-soft transition hover:bg-bg"
                        >
                            {strings.common.cancel}
                        </button>
                        <button
                            type="button"
                            disabled={busy || reply.trim().length === 0}
                            onClick={() => {
                                respond(reply);
                                setEditing(false);
                            }}
                            className="rounded-md bg-accent px-3.5 py-1.5 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                        >
                            {busy ? strings.common.saving : strings.reviews.postReply}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="mt-3 flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => {
                            setEditing(true);
                        }}
                        className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:bg-bg"
                    >
                        {review.response !== null
                            ? strings.reviews.editReply
                            : strings.reviews.reply}
                    </button>
                    {canPublish ? (
                        <button
                            type="button"
                            disabled={busy}
                            onClick={publish}
                            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                        >
                            {busy ? strings.common.working : strings.reviews.publish}
                        </button>
                    ) : null}
                    {canHide ? (
                        <button
                            type="button"
                            disabled={busy}
                            onClick={hide}
                            className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:bg-bg disabled:opacity-60"
                        >
                            {busy ? strings.common.working : strings.reviews.hide}
                        </button>
                    ) : null}
                </div>
            )}

            {error !== null ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
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
                <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
                    {strings.reviews.clientLabel}
                    <select
                        value={form.clientId}
                        onChange={(e) => {
                            form.setClientId(e.target.value);
                        }}
                        className={field}
                    >
                        <option value="">{strings.reviews.selectClient}</option>
                        {clients.map((cl) => (
                            <option key={cl.id} value={cl.id}>
                                {cl.name}
                            </option>
                        ))}
                    </select>
                </label>
                {form.error !== null ? <p className="text-sm text-danger">{form.error}</p> : null}
                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-bg"
                    >
                        {strings.common.cancel}
                    </button>
                    <button
                        type="submit"
                        disabled={form.busy}
                        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
                    >
                        {form.busy ? strings.reviews.sending : strings.reviews.sendRequest}
                    </button>
                </div>
            </form>
        </section>
    );
}
