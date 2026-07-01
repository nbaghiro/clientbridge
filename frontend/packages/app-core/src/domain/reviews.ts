import { useQuery } from "@powersync/react";
import { useEffect, useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import type { ApiLike } from "../util/api";
import { newIdempotencyKey } from "../util/primitives";
import type { Intent } from "../util/primitives";

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

const REVIEWS_SQL = `
SELECT r.id, r.client_id, r.booking_id, r.rating, r.body, r.response, r.responded_at,
       r.sent_to_google, r.status, r.created_at, c.name AS client_name
FROM reviews r
LEFT JOIN clients c ON c.id = r.client_id
ORDER BY r.created_at DESC`;

/** Every review, newest first, joined to the client's name (LEFT — a deleted client still lists). */
export function useReviews(): ReviewRow[] {
    return useQuery<ReviewRow>(REVIEWS_SQL).data;
}

export interface ReviewSummary {
    average: number | null; // mean rating over published reviews; null when there are none
    count: number;
}

export const MAX_STARS = 5;

/** One-decimal average for display (a null/absent average shows as "0.0"). */
export function formatAverageRating(average: number | null): string {
    return (average ?? 0).toFixed(1);
}

/** The whole-star count for an average (rounded; drives the filled stars). */
export function roundedRating(average: number | null): number {
    return Math.round(average ?? 0);
}

/** The empty-star count that pads a filled rating out to `MAX_STARS`. */
export function emptyStars(filled: number): number {
    return Math.max(0, MAX_STARS - filled);
}

/** The published-reviews summary (REST). `null` = loading, `"error"` = the fetch failed. Bump
 *  `reloadKey` to refetch after a publish/hide changes which reviews count. */
export function useReviewSummary(api: ApiLike, reloadKey = 0): ReviewSummary | "error" | null {
    const [summary, setSummary] = useState<ReviewSummary | "error" | null>(null);
    useEffect(() => {
        void api
            .get<ReviewSummary>("/v1/reviews/summary")
            .then(setSummary)
            .catch(() => {
                setSummary("error");
            });
    }, [api, reloadKey]);
    return summary;
}

export interface ReviewRequestResult {
    id: string;
    business_id: string;
    client_id: string;
    booking_id: string | null;
    channel: string;
    status: string;
    token: string;
    sent_at: string | null;
    review_id: string | null;
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

export interface ReviewResult {
    id: string;
    business_id: string;
    client_id: string;
    booking_id: string | null;
    rating: number;
    body: string | null;
    response: string | null;
    responded_at: string | null;
    sent_to_google: boolean;
    status: string;
}

export function respondToReview(api: ApiLike, id: string, response: string): Promise<ReviewResult> {
    return api.post<ReviewResult>(`/v1/reviews/${id}/respond`, { response });
}

export function hideReview(api: ApiLike, id: string): Promise<ReviewResult> {
    return api.post<ReviewResult>(`/v1/reviews/${id}/hide`, {});
}

export function publishReview(api: ApiLike, id: string): Promise<ReviewResult> {
    return api.post<ReviewResult>(`/v1/reviews/${id}/publish`, {});
}

export function markSentToGoogle(api: ApiLike, id: string): Promise<ReviewResult> {
    return api.post<ReviewResult>(`/v1/reviews/${id}/google`, {});
}

export function reviewStatusIntent(status: string): Intent {
    switch (status) {
        case "published":
            return "success";
        case "hidden":
            return "neutral";
        default:
            return "warning"; // pending
    }
}

export interface ReviewActions {
    busy: boolean;
    error: string | null;
    canPublish: boolean;
    canHide: boolean;
    respond: (text: string) => void;
    hide: () => void;
    publish: () => void;
}

/** The respond / hide / publish lifecycle as a view-model, mirroring `useAllocationActions`. The
 *  synced row updates itself once a command lands; `onDone` is for surfaces that also want to react
 *  (e.g. refresh the summary, close an inline editor). */
export function useReviewActions(
    api: ApiLike,
    review: ReviewRow,
    onDone?: () => void,
): ReviewActions {
    const { busy, error, run } = useAsyncAction();

    const respond = (text: string): void => {
        const trimmed = text.trim();
        if (trimmed.length === 0) return;
        void run(() => respondToReview(api, review.id, trimmed), {
            onSuccess: () => onDone?.(),
            errorMessage: "Couldn't post your reply. Please try again.",
        });
    };
    const hide = (): void => {
        void run(() => hideReview(api, review.id), {
            onSuccess: () => onDone?.(),
            errorMessage: "Couldn't hide this review. Please try again.",
        });
    };
    const publish = (): void => {
        void run(() => publishReview(api, review.id), {
            onSuccess: () => onDone?.(),
            errorMessage: "Couldn't publish this review. Please try again.",
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

export interface RequestReviewForm {
    clientId: string;
    setClientId: (v: string) => void;
    busy: boolean;
    error: string | null;
    submit: () => void;
}

/** Shared "request a review" form: the picked client + busy/error + submit (mirrors `useClientForm`). */
export function useRequestReviewForm(api: ApiLike, onSent: () => void): RequestReviewForm {
    const [clientId, setClientId] = useState("");
    const { busy, error, setError, run } = useAsyncAction();

    const submit = (): void => {
        if (clientId.length === 0) {
            setError("Select a client");
            return;
        }
        void run(() => requestReview(api, { client_id: clientId }), {
            onSuccess: () => {
                setClientId("");
                onSent();
            },
            errorMessage: "Couldn't send the review request. Please try again.",
        });
    };

    return { clientId, setClientId, busy, error, submit };
}
