import { useBusinessQuery as useQuery } from "../hooks";

import { useMemo, useState } from "react";

import { type ApiLike, newIdempotencyKey } from "../api";
import { formatDate, parseTimestamp } from "../datetime";
import { firstName } from "../format";
import { type Load, useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { Intent } from "../ui";
import { useClients } from "./clients";
import { useReplicaLoad } from "./sync";

export interface ReviewRow {
    id: string;
    client_id: string;
    booking_id: string | null;
    rating: number;
    body: string | null;
    response: string | null;
    responded_at: string | null;
    sent_to_google: number;
    status: string;
    created_at: string;
    submitted_at: string | null;
    client_name: string | null;
    service: string | null;
    staff_name: string | null;
    pet_name: string | null;
    visit_at: string | null;
}

export const REVIEWS_SQL = `
SELECT r.id, r.client_id, r.booking_id, r.rating, r.body, r.response, r.responded_at,
       r.sent_to_google, r.status, r.created_at, r.submitted_at, c.name AS client_name,
       i.name AS service, st.name AS staff_name, p.name AS pet_name, sl.starts_at AS visit_at
FROM reviews r
LEFT JOIN clients c ON c.id = r.client_id
LEFT JOIN bookings b ON b.id = r.booking_id
LEFT JOIN slots sl ON sl.id = b.slot_id
LEFT JOIN items i ON i.id = sl.item_id
LEFT JOIN staff st ON st.id = b.staff_id
LEFT JOIN subjects p ON p.id = b.subject_id
WHERE r.status IN ('submitted', 'published', 'hidden')
ORDER BY COALESCE(r.submitted_at, r.created_at) DESC`;

export const REVIEW_REQUESTS_SQL = `
SELECT r.id, r.client_id, r.status, COALESCE(r.requested_at, r.created_at) AS requested_at,
       c.name AS client_name
FROM reviews r LEFT JOIN clients c ON c.id = r.client_id
WHERE r.status IN ('requested', 'opened')
ORDER BY requested_at DESC`;

// Completed visits since `?` whose client hasn't been asked or reviewed since.
export const REVIEW_SUGGESTIONS_SQL = `
SELECT b.client_id, c.name AS client_name, i.name AS service, MAX(b.completed_at) AS completed_at
FROM bookings b
JOIN clients c ON c.id = b.client_id
LEFT JOIN slots sl ON sl.id = b.slot_id
LEFT JOIN items i ON i.id = sl.item_id
WHERE b.status = 'completed' AND b.completed_at >= ? AND c.status = 'active'
  AND NOT EXISTS (
      SELECT 1 FROM reviews r WHERE r.client_id = b.client_id AND r.created_at >= b.completed_at
  )
GROUP BY b.client_id
ORDER BY completed_at DESC
LIMIT 8`;

export const REVIEW_SETTINGS_SQL =
    "SELECT review_hold_at, google_review_url FROM businesses LIMIT 1";

export function useReviews(): ReviewRow[] {
    return useQuery<ReviewRow>(REVIEWS_SQL).data;
}

interface ReviewRequestRow {
    id: string;
    client_id: string;
    status: string;
    requested_at: string;
    client_name: string | null;
}

interface ReviewSuggestion {
    clientId: string;
    clientName: string;
    visit: string;
}

const r = strings.reviews;

export function formatAverageRating(average: number | null): string {
    return (average ?? 0).toFixed(1);
}

export function roundedRating(average: number | null): number {
    return Math.round(average ?? 0);
}

const isHeld = (review: ReviewRow): boolean => review.status === "submitted";

export function reviewState(review: ReviewRow): { label: string; intent: Intent } {
    if (isHeld(review)) return { label: r.state.held, intent: "warning" };
    if (review.status === "hidden") return { label: r.state.hidden, intent: "neutral" };
    return { label: r.state.published, intent: "success" };
}

/** "Full groom with Hannah · Oct 8", or just the date when the review has no booking. */
export function reviewVisitLine(review: ReviewRow): string {
    const when = formatDate(parseTimestamp(review.visit_at ?? review.created_at));
    if (review.service === null) return when;
    const staff = review.staff_name === null ? null : firstName(review.staff_name);
    return staff === null
        ? `${review.service} · ${when}`
        : r.visitLine(review.service, staff, when);
}

export function suggestedReply(review: ReviewRow): string {
    return r.suggestedReplyFor(firstName(review.client_name ?? ""), review.rating <= 3);
}

const DEFAULT_HOLD = 3;
const SUGGEST_DAYS = 3;

export interface ReviewQueue {
    load: Load;
    all: ReviewRow[];
    held: ReviewRow[];
    published: ReviewRow[];
    hidden: ReviewRow[];
    requests: ReviewRequestRow[];
    suggestions: ReviewSuggestion[];
    average: number;
    count: number;
    distribution: { stars: number; count: number }[];
    googleUrl: string | null;
    holdLow: boolean;
    clientOptions: { key: string; label: string }[];
}

export function useReviewQueue(): ReviewQueue {
    const reviews = useQuery<ReviewRow>(REVIEWS_SQL);
    const requests = useQuery<ReviewRequestRow>(REVIEW_REQUESTS_SQL);
    const since = useMemo(() => new Date(Date.now() - SUGGEST_DAYS * 86_400_000).toISOString(), []);
    const suggestions = useQuery<{
        client_id: string;
        client_name: string;
        service: string | null;
        completed_at: string;
    }>(REVIEW_SUGGESTIONS_SQL, [since]);
    const settings = useQuery<{ review_hold_at: number | null; google_review_url: string | null }>(
        REVIEW_SETTINGS_SQL,
    ).data[0];
    const clients = useClients();
    const all = reviews.data;
    const published = all.filter((x) => x.status === "published");
    const load = useReplicaLoad(
        [reviews, requests, suggestions],
        all.length === 0 && requests.data.length === 0,
    );
    const average = published.length
        ? published.reduce((n, x) => n + x.rating, 0) / published.length
        : 0;
    return {
        load,
        all,
        held: all.filter(isHeld),
        published,
        hidden: all.filter((x) => x.status === "hidden"),
        requests: requests.data,
        suggestions: suggestions.data.map((s) => ({
            clientId: s.client_id,
            clientName: s.client_name,
            visit: [s.service, formatDate(parseTimestamp(s.completed_at))]
                .filter((v) => v !== null)
                .join(" · "),
        })),
        average,
        count: published.length,
        distribution: [5, 4, 3, 2, 1].map((stars) => ({
            stars,
            count: published.filter((x) => x.rating === stars).length,
        })),
        googleUrl: settings?.google_review_url ?? null,
        holdLow: (settings?.review_hold_at ?? DEFAULT_HOLD) > 0,
        clientOptions: clients.map((c) => ({ key: c.id, label: c.name })),
    };
}

interface ReviewSettings {
    holdLow: boolean;
    setHoldLow: (on: boolean) => void;
    googleUrl: string;
    setGoogleUrl: (v: string) => void;
    saveGoogleUrl: () => void;
    savedGoogle: boolean;
    busy: boolean;
    error: string | null;
}

/** The hold toggle saves at once; the Google link saves on its own button. */
export function useReviewSettings(api: ApiLike, queue: ReviewQueue): ReviewSettings {
    const [hold, setHold] = useState<boolean | null>(null);
    const [url, setUrl] = useState<string | null>(null);
    const [savedGoogle, setSavedGoogle] = useState(false);
    const { busy, error, setError, run } = useAsyncAction();
    return {
        holdLow: hold ?? queue.holdLow,
        setHoldLow: (on) => {
            setHold(on);
            run(
                async () => {
                    try {
                        await api.patch("/v1/business", { review_hold_at: on ? DEFAULT_HOLD : 0 });
                    } catch (e) {
                        setHold(null);
                        throw e;
                    }
                },
                { errorMessage: r.settingsError },
            );
        },
        googleUrl: url ?? queue.googleUrl ?? "",
        setGoogleUrl: (v) => {
            setSavedGoogle(false);
            setUrl(v);
        },
        saveGoogleUrl: () => {
            const value = (url ?? "").trim();
            if (value !== "" && !value.startsWith("https://")) {
                setError(r.googleUrlInvalid);
                return;
            }
            run(() => api.patch("/v1/business", { google_review_url: value }), {
                errorMessage: r.settingsError,
                onSuccess: () => {
                    setSavedGoogle(true);
                },
            });
        },
        savedGoogle,
        busy,
        error,
    };
}

interface ModeratedReview {
    held: boolean;
    canShare: boolean;
    busy: boolean;
    error: string | null;
    publish: () => void;
    hide: () => void;
    respond: (text: string) => void;
    share: () => void;
}

/** Sharing records the share and hands back the Google link for the caller to open. */
export function useModeratedReview(
    api: ApiLike,
    review: ReviewRow,
    openLink: (url: string) => void,
): ModeratedReview {
    const { busy, error, run } = useAsyncAction();
    return {
        held: isHeld(review),
        canShare: review.status === "published" && review.sent_to_google !== 1,
        busy,
        error,
        publish: () => {
            run(() => api.post(`/v1/reviews/${review.id}/publish`, {}), {
                errorMessage: r.publishError,
            });
        },
        hide: () => {
            run(() => api.post(`/v1/reviews/${review.id}/hide`, {}), {
                errorMessage: r.hideError,
            });
        },
        respond: (text) => {
            const trimmed = text.trim();
            if (trimmed === "") return;
            run(() => api.post(`/v1/reviews/${review.id}/respond`, { response: trimmed }), {
                errorMessage: r.postReplyError,
            });
        },
        share: () => {
            run(
                async () => {
                    const out = await api.post<{ google_review_url: string }>(
                        `/v1/reviews/${review.id}/share`,
                        {},
                    );
                    openLink(out.google_review_url);
                },
                { errorMessage: r.shareError },
            );
        },
    };
}

interface RequestReview {
    sent: Set<string>;
    busyId: string | null;
    error: string | null;
    request: (clientId: string) => void;
}

export function useRequestReview(api: ApiLike): RequestReview {
    const [sent, setSent] = useState<Set<string>>(new Set());
    const [busyId, setBusyId] = useState<string | null>(null);
    const { error, run } = useAsyncAction();
    return {
        sent,
        busyId,
        error,
        request: (clientId) => {
            setBusyId(clientId);
            run(
                async () => {
                    try {
                        await api.post(
                            "/v1/reviews/request",
                            { client_id: clientId, booking_id: null },
                            { idempotencyKey: newIdempotencyKey() },
                        );
                    } finally {
                        setBusyId(null);
                    }
                },
                {
                    onSuccess: () => {
                        setSent((s) => new Set(s).add(clientId));
                    },
                    errorMessage: r.sendRequestError,
                },
            );
        },
    };
}
