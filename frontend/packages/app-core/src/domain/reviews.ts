import { useMemo, useState } from "react";

import { type ApiLike, newIdempotencyKey } from "../api";
import { formatDate, parseTimestamp, useBusinessZone } from "../datetime";
import { formatParts } from "../format";
import { type Load, useAsyncAction, useBusinessQuery as useQuery } from "../hooks";
import { strings } from "../strings";
import { useClients } from "./clients";
import { useReplicaLoad } from "./sync";

export const REVIEW_REQUESTS_SQL = `
SELECT r.id, r.client_id, r.requested_at, c.name AS client_name
FROM review_requests r LEFT JOIN clients c ON c.id = r.client_id
ORDER BY r.requested_at DESC, r.id DESC`;

export const REVIEW_SUGGESTIONS_SQL = `
SELECT b.id AS booking_id, b.client_id, c.name AS client_name, i.name AS service, b.completed_at
FROM bookings b
JOIN clients c ON c.id = b.client_id
LEFT JOIN slots sl ON sl.id = b.slot_id
LEFT JOIN items i ON i.id = sl.item_id
WHERE b.status = 'completed' AND b.completed_at >= ? AND c.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM review_requests r WHERE r.booking_id = b.id)
ORDER BY b.completed_at DESC, b.id DESC
LIMIT 8`;

export const REVIEW_SETTINGS_SQL = "SELECT google_review_url FROM businesses LIMIT 1";

interface ReviewRequestRow {
    id: string;
    client_id: string;
    requested_at: string;
    client_name: string | null;
}

export interface ReviewQueue {
    load: Load;
    requests: ReviewRequestRow[];
    suggestions: { bookingId: string; clientId: string; clientName: string; visit: string }[];
    googleUrl: string | null;
    clientOptions: { key: string; label: string }[];
}

export function useReviewQueue(): ReviewQueue {
    const zone = useBusinessZone();
    const requests = useQuery<ReviewRequestRow>(REVIEW_REQUESTS_SQL);
    const since = useMemo(() => new Date(Date.now() - 3 * 86_400_000).toISOString(), []);
    const suggestions = useQuery<{
        booking_id: string;
        client_id: string;
        client_name: string;
        service: string | null;
        completed_at: string;
    }>(REVIEW_SUGGESTIONS_SQL, [since]);
    const settings = useQuery<{ google_review_url: string | null }>(REVIEW_SETTINGS_SQL);
    const clients = useClients();
    return {
        load: useReplicaLoad([requests, suggestions, settings], requests.data.length === 0),
        requests: requests.data,
        suggestions: suggestions.data.map((s) => ({
            bookingId: s.booking_id,
            clientId: s.client_id,
            clientName: s.client_name,
            visit: formatParts([s.service, formatDate(parseTimestamp(s.completed_at), zone)]),
        })),
        googleUrl: settings.data[0]?.google_review_url ?? null,
        clientOptions: clients.map((c) => ({ key: c.id, label: c.name })),
    };
}

export function useReviewSettings(api: ApiLike, queue: ReviewQueue) {
    const [url, setUrl] = useState<string | null>(null);
    const [savedGoogle, setSavedGoogle] = useState(false);
    const { busy, error, setError, run } = useAsyncAction();
    const r = strings.reviews;
    return {
        googleUrl: url ?? queue.googleUrl ?? "",
        setGoogleUrl: (v: string) => {
            setSavedGoogle(false);
            setUrl(v);
        },
        saveGoogleUrl: () => {
            const value = (url ?? queue.googleUrl ?? "").trim();
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

export function useRequestReview(api: ApiLike) {
    const [sent, setSent] = useState<Set<string>>(new Set());
    const [busyId, setBusyId] = useState<string | null>(null);
    const { error, run } = useAsyncAction();
    return {
        sent,
        busyId,
        error,
        request: (clientId: string, bookingId: string | null = null) => {
            const identity = bookingId ?? clientId;
            setBusyId(identity);
            run(
                async () => {
                    try {
                        await api.post(
                            "/v1/reviews/request",
                            { client_id: clientId, booking_id: bookingId },
                            { idempotencyKey: newIdempotencyKey() },
                        );
                    } finally {
                        setBusyId(null);
                    }
                },
                {
                    onSuccess: () => {
                        setSent((s) => new Set(s).add(identity));
                    },
                    errorMessage: strings.reviews.sendRequestError,
                },
            );
        },
    };
}
