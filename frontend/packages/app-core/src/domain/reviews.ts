import { useQuery } from "@powersync/react";
import { useEffect, useState } from "react";

import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import { type ApiLike, newIdempotencyKey } from "../api";
import type { Intent } from "../ui";

export interface ReviewRow {
    id: string;
    client_id: string;
    booking_id: string | null;
    rating: number;
    body: string | null;
    response: string | null;
    responded_at: string | null;
    sent_to_google: number; // SQLite boolean → 0/1
    status: string;
    created_at: string;
    client_name: string | null;
}

export const REVIEWS_SQL = `
SELECT r.id, r.client_id, r.booking_id, r.rating, r.body, r.response, r.responded_at,
       r.sent_to_google, r.status, r.created_at, c.name AS client_name
FROM reviews r
LEFT JOIN clients c ON c.id = r.client_id
WHERE r.status IN ('submitted', 'published', 'hidden')
ORDER BY COALESCE(r.submitted_at, r.created_at) DESC`;

/** LEFT join so a deleted client's reviews still list; unanswered requests are in `useAwaitingReviews`. */
export function useReviews(): ReviewRow[] {
    return useQuery<ReviewRow>(REVIEWS_SQL).data;
}

export const AWAITING_REVIEWS_SQL =
    "SELECT COUNT(*) AS n FROM reviews WHERE status IN ('requested', 'opened')";

export function useAwaitingReviews(): number {
    return useQuery<{ n: number }>(AWAITING_REVIEWS_SQL).data[0]?.n ?? 0;
}

interface ReviewSummary {
    average: number | null; // mean rating over published reviews; null when there are none
    count: number;
}

/** One-decimal average for display (a null/absent average shows as "0.0"). */
export function formatAverageRating(average: number | null): string {
    return (average ?? 0).toFixed(1);
}

export function roundedRating(average: number | null): number {
    return Math.round(average ?? 0);
}

/** `null` while loading, `"error"` if the fetch failed; bump `reloadKey` to refetch. */
export function useReviewSummary(api: ApiLike, reloadKey = 0): ReviewSummary | "error" | null {
    const [summary, setSummary] = useState<ReviewSummary | "error" | null>(null);
    useEffect(() => {
        api.get<ReviewSummary>("/v1/reviews/summary")
            .then(setSummary)
            .catch(() => {
                setSummary("error");
            });
    }, [api, reloadKey]);
    return summary;
}

interface ReviewRequestResult {
    id: string;
    business_id: string;
    client_id: string;
    booking_id: string | null;
    channel: string;
    status: string;
    token: string;
    requested_at: string | null;
}

export function requestReview(
    api: ApiLike,
    input: { client_id: string; booking_id?: string | null },
): Promise<ReviewRequestResult> {
    return api.post<ReviewRequestResult>(
        "/v1/reviews/request",
        { client_id: input.client_id, booking_id: input.booking_id ?? null },
        { idempotencyKey: newIdempotencyKey() },
    );
}

interface ReviewResult {
    id: string;
    business_id: string;
    client_id: string;
    booking_id: string | null;
    rating: number | null;
    body: string | null;
    response: string | null;
    responded_at: string | null;
    sent_to_google: boolean;
    status: string;
    requested_at: string | null;
    submitted_at: string | null;
}

function respondToReview(api: ApiLike, id: string, response: string): Promise<ReviewResult> {
    return api.post<ReviewResult>(`/v1/reviews/${id}/respond`, { response });
}

function hideReview(api: ApiLike, id: string): Promise<ReviewResult> {
    return api.post<ReviewResult>(`/v1/reviews/${id}/hide`, {});
}

function publishReview(api: ApiLike, id: string): Promise<ReviewResult> {
    return api.post<ReviewResult>(`/v1/reviews/${id}/publish`, {});
}

export function reviewStatusIntent(status: string): Intent {
    switch (status) {
        case "published":
            return "success";
        case "hidden":
            return "neutral";
        default:
            return "warning"; // submitted, awaiting a publish or hide
    }
}

interface ReviewActions {
    busy: boolean;
    error: string | null;
    canPublish: boolean;
    canHide: boolean;
    respond: (text: string) => void;
    hide: () => void;
    publish: () => void;
}

/** The synced row updates itself once a command lands; `onDone` is for refreshing the summary. */
export function useReviewActions(
    api: ApiLike,
    review: ReviewRow,
    onDone?: () => void,
): ReviewActions {
    const { busy, error, run } = useAsyncAction();

    const respond = (text: string): void => {
        const trimmed = text.trim();
        if (trimmed.length === 0) return;
        run(() => respondToReview(api, review.id, trimmed), {
            onSuccess: () => onDone?.(),
            errorMessage: strings.reviews.postReplyError,
        });
    };
    const hide = (): void => {
        run(() => hideReview(api, review.id), {
            onSuccess: () => onDone?.(),
            errorMessage: strings.reviews.hideError,
        });
    };
    const publish = (): void => {
        run(() => publishReview(api, review.id), {
            onSuccess: () => onDone?.(),
            errorMessage: strings.reviews.publishError,
        });
    };

    return {
        busy,
        error,
        canPublish: review.status !== "published",
        canHide: review.status !== "hidden",
        respond,
        hide,
        publish,
    };
}

interface RequestReviewForm {
    clientId: string;
    setClientId: (v: string) => void;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

export function useRequestReviewForm(api: ApiLike, onSent: () => void): RequestReviewForm {
    const [clientId, setClientId] = useState("");
    const { busy, error, setError, run } = useAsyncAction();

    const submit = (): void => {
        if (clientId.length === 0) {
            setError(strings.reviews.selectClient);
            return;
        }
        run(() => requestReview(api, { client_id: clientId }), {
            onSuccess: () => {
                setClientId("");
                onSent();
            },
            errorMessage: strings.reviews.sendRequestError,
        });
    };

    return { clientId, setClientId, busy, error, submit };
}
