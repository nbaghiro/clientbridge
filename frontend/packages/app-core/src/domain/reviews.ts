import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type ApiLike, failedCode, newIdempotencyKey } from "../api";
import { formatDate, parseTimestamp, useBusinessZone } from "../datetime";
import { formatParts, formatRating } from "../format";
import { type Load, useAsyncAction, useBusinessQuery as useQuery } from "../hooks";
import { strings } from "../strings";
import type { SelectOption } from "../ui";
import { personMedia, usePeoplePhotos } from "./files";
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

const REVIEW_AUTOMATION_SQL = `SELECT review_requests_enabled FROM businesses LIMIT 1`;

/** Whether the morning job asks clients for a review after a completed visit. */
export function useReviewAutomation(api: ApiLike) {
    const query = useQuery<{ review_requests_enabled: number }>(REVIEW_AUTOMATION_SQL);
    const [pending, setPending] = useState<boolean | null>(null);
    const { busy, error, run } = useAsyncAction();
    const stored = (query.data[0]?.review_requests_enabled ?? 1) === 1;
    // the saved choice shows until the replica catches up with it
    useEffect(() => {
        if (pending === stored) setPending(null);
    }, [pending, stored]);
    return {
        enabled: pending ?? stored,
        busy,
        error,
        setEnabled: (enabled: boolean) => {
            run(
                async () => {
                    setPending(enabled);
                    try {
                        await api.patch("/v1/business", { review_requests_enabled: enabled });
                    } catch (failure) {
                        setPending(null);
                        throw failure;
                    }
                },
                { errorMessage: strings.reviews.automationError },
            );
        },
    };
}

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
    canRequest: boolean;
    clientOptions: SelectOption<string>[];
}

export function useReviewQueue(canRequest: boolean): ReviewQueue {
    const photos = usePeoplePhotos();
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
    const clients = useClients();
    return {
        load: useReplicaLoad([requests, suggestions], requests.data.length === 0),
        requests: requests.data,
        suggestions: suggestions.data.map((s) => ({
            bookingId: s.booking_id,
            clientId: s.client_id,
            clientName: s.client_name,
            visit: formatParts([s.service, formatDate(parseTimestamp(s.completed_at), zone)]),
        })),
        canRequest,
        clientOptions: clients.map((c) => ({
            key: c.id,
            label: c.name,
            media: personMedia(c.name, null, photos.client(c.id)),
        })),
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

interface GoogleReviewConnection {
    state: "unavailable" | "disconnected" | "selecting" | "active" | "reconnect_required";
    connection_id: string | null;
    generation: number;
    location: { name: string; title: string } | null;
    can_request: boolean;
}

interface GoogleReview {
    review_id: string;
    reviewer: { display_name: string | null; anonymous: boolean };
    star_rating: "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE";
    comment: string | null;
    create_time: string;
    update_time: string;
    reply: { comment: string; update_time: string | null } | null;
}

interface GoogleReviewPage {
    reviews: GoogleReview[];
    average_rating: number | null;
    total_count: number;
    next_page_token: string | null;
}
interface GoogleChoices {
    choices: { name: string; title: string }[];
    next_page_token: string | null;
}
interface GoogleReplyOperation {
    id: string;
    state: "queued" | "running" | "confirmed" | "failed" | "unknown" | "canceled";
}

const GOOGLE = "/v1/reviews/google";
const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

function googleMessage(cause: unknown): string {
    const s = strings.reviews;
    switch (failedCode(cause)) {
        case "google_reconnect_required":
            return s.reconnectBody;
        case "google_access_denied":
            return s.accessDenied;
        case "google_rate_limited":
            return s.rateLimited;
        case "google_not_configured":
            return s.unavailable;
        case "google_stale_reply":
            return s.staleReply;
        default:
            return s.googleError;
    }
}

export function useGoogleReviews(api: ApiLike) {
    const zone = useBusinessZone();
    const [scope, setScope] = useState(api);
    const sameScope = scope === api;
    const [connection, setConnection] = useState<GoogleReviewConnection | null>(null);
    const [page, setPage] = useState<GoogleReviewPage | null>(null);
    const [accounts, setAccounts] = useState<GoogleChoices | null>(null);
    const [locations, setLocations] = useState<GoogleChoices | null>(null);
    const [account, setAccount] = useState("");
    const [location, setLocation] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [reply, setReply] = useState<GoogleReview | null>(null);
    const [comment, setComment] = useState("");
    const [confirm, setConfirm] = useState<"disconnect" | "deleteReply" | null>(null);
    const [pendingReply, setPendingReply] = useState(false);
    const generation = useRef(0);
    const locationGeneration = useRef(0);
    const actionRef = useRef<object | null>(null);
    const key = useRef<{ signature: string; value: string } | null>(null);
    const currentApi = useRef(api);
    currentApi.current = api;
    const s = strings.reviews;

    const load = useCallback(async (): Promise<void> => {
        const version = ++generation.current;
        setLoading(true);
        setError(null);
        setPage(null);
        setReply(null);
        setComment("");
        setConfirm(null);
        setPendingReply(false);
        try {
            const status = await api.get<GoogleReviewConnection>(GOOGLE);
            if (version !== generation.current) return;
            setConnection(status);
            if (status.state === "active") {
                const reviews = await api.get<GoogleReviewPage>(`${GOOGLE}/reviews`);
                if (version === generation.current) setPage(reviews);
            } else if (status.state === "selecting") {
                const choices = await api.get<GoogleChoices>(`${GOOGLE}/accounts`);
                if (version === generation.current) setAccounts(choices);
            }
        } catch (cause) {
            if (version === generation.current) {
                setError(googleMessage(cause));
                if (failedCode(cause) === "google_reconnect_required") {
                    setConnection((value) =>
                        value === null
                            ? null
                            : { ...value, state: "reconnect_required", can_request: false },
                    );
                }
            }
        } finally {
            if (version === generation.current) setLoading(false);
        }
    }, [api]);
    useEffect(() => {
        setScope(api);
        setConnection(null);
        setAccounts(null);
        setLocations(null);
        setAccount("");
        setLocation("");
        setBusy(null);
        actionRef.current = null;
        key.current = null;
        load().catch((cause: unknown) => {
            setError(googleMessage(cause));
        });
        return () => {
            generation.current += 1;
            locationGeneration.current += 1;
        };
    }, [api, load]);

    const execute = (action: string, work: (valid: () => boolean) => Promise<void>): void => {
        if (actionRef.current !== null) return;
        const actionToken = {};
        actionRef.current = actionToken;
        const version = generation.current;
        const valid = () => version === generation.current && currentApi.current === api;
        setError(null);
        setBusy(action);
        work(valid)
            .catch((cause: unknown) => {
                if (valid()) {
                    setError(googleMessage(cause));
                    if (failedCode(cause) === "google_reconnect_required") {
                        setPage(null);
                        setReply(null);
                        setConnection((value) =>
                            value === null
                                ? null
                                : { ...value, state: "reconnect_required", can_request: false },
                        );
                    }
                }
            })
            .finally(() => {
                if (actionRef.current === actionToken) {
                    actionRef.current = null;
                    setBusy(null);
                    setPendingReply(false);
                }
            });
    };
    const options = (choices: GoogleChoices | null) =>
        choices?.choices.map((value) => ({ key: value.name, label: value.title })) ?? [];
    const mutationKey = (signature: string) => {
        if (key.current?.signature !== signature)
            key.current = { signature, value: newIdempotencyKey() };
        return key.current.value;
    };
    const pause = () =>
        new Promise<void>((resolve) => {
            setTimeout(resolve, 1500);
        });
    const postReply = (remove: boolean): void => {
        if (reply === null) return;
        if (!remove && (comment.trim() === "" || new TextEncoder().encode(comment).length > 4096)) {
            setError(s.replyInvalid);
            return;
        }
        const body = {
            review_id: reply.review_id,
            comment: remove ? null : comment.trim(),
            expected_reply_revision: reply.reply?.update_time ?? null,
        };
        execute("reply", async (valid) => {
            let result = await api.post<GoogleReplyOperation>(
                `${GOOGLE}/replies${remove ? "/delete" : ""}`,
                body,
                { idempotencyKey: mutationKey(JSON.stringify(body)) },
            );
            if (!valid()) return;
            setConfirm(null);
            setPendingReply(true);
            for (
                let attempt = 0;
                attempt < 20 && (result.state === "queued" || result.state === "running");
                attempt++
            ) {
                await pause();
                if (!valid()) return;
                result = await api.get<GoogleReplyOperation>(
                    `${GOOGLE}/operations/${encodeURIComponent(result.id)}`,
                );
            }
            if (!valid()) return;
            if (result.state === "confirmed") {
                key.current = null;
                await load();
            } else {
                setPendingReply(false);
                setError(
                    result.state === "failed" || result.state === "canceled"
                        ? s.replyFailed
                        : s.replyUncertain,
                );
            }
        });
    };
    return {
        connection: sameScope ? connection : null,
        loading: !sameScope || loading,
        error: sameScope ? error : null,
        busy: sameScope ? busy : null,
        pendingReply: sameScope && pendingReply,
        confirm: sameScope ? confirm : null,
        setConfirm,
        connected: sameScope && !loading && connection?.state === "active" && page !== null,
        canRequest:
            sameScope &&
            !loading &&
            connection?.state === "active" &&
            connection.can_request &&
            page !== null,
        refresh: () => {
            load().catch((cause: unknown) => {
                setError(googleMessage(cause));
            });
        },
        connect: (platform: "web" | "native", open: (url: string) => void, close: () => void) => {
            execute("connect", async (valid) => {
                try {
                    const flow = await api.post<{ authorization_url: string; flow_token: string }>(
                        `${GOOGLE}/authorization`,
                        { platform },
                    );
                    if (!valid()) return;
                    open(flow.authorization_url);
                    for (let attempt = 0; attempt < 400; attempt++) {
                        await pause();
                        if (!valid()) return;
                        const result = await api.post<{ state: "pending" | "complete" | "failed" }>(
                            `${GOOGLE}/authorization/complete`,
                            { flow_token: flow.flow_token },
                        );
                        if (!valid()) return;
                        if (result.state === "complete") {
                            await load();
                            return;
                        }
                        if (result.state === "failed") throw new Error("authorization failed");
                    }
                    if (valid()) setError(s.authorizationExpired);
                } finally {
                    close();
                }
            });
        },
        cancelConnect: () => {
            generation.current += 1;
            actionRef.current = null;
            setBusy(null);
        },
        account,
        location,
        setLocation,
        accountOptions: options(accounts),
        locationOptions: options(locations),
        moreAccounts: accounts?.next_page_token !== null && accounts?.next_page_token !== undefined,
        moreLocations:
            locations?.next_page_token !== null && locations?.next_page_token !== undefined,
        loadAccounts: () => {
            execute("accounts", async (valid) => {
                const next = await api.get<GoogleChoices>(
                    `${GOOGLE}/accounts?page_token=${encodeURIComponent(accounts?.next_page_token ?? "")}`,
                );
                if (valid())
                    setAccounts({
                        ...next,
                        choices: [...(accounts?.choices ?? []), ...next.choices],
                    });
            });
        },
        chooseAccount: (value: string) => {
            const version = ++locationGeneration.current;
            setAccount(value);
            setLocation("");
            setLocations(null);
            if (value === "") return;
            execute("locations", async (valid) => {
                const next = await api.get<GoogleChoices>(
                    `${GOOGLE}/locations?account_name=${encodeURIComponent(value)}`,
                );
                if (valid() && version === locationGeneration.current) setLocations(next);
            });
        },
        loadLocations: () => {
            execute("locations", async (valid) => {
                const next = await api.get<GoogleChoices>(
                    `${GOOGLE}/locations?account_name=${encodeURIComponent(account)}&page_token=${encodeURIComponent(locations?.next_page_token ?? "")}`,
                );
                if (valid())
                    setLocations({
                        ...next,
                        choices: [...(locations?.choices ?? []), ...next.choices],
                    });
            });
        },
        selectLocation: () => {
            execute("select", async (valid) => {
                await api.post(
                    `${GOOGLE}/location`,
                    { account_name: account, location_name: location },
                    { idempotencyKey: mutationKey(JSON.stringify({ account, location })) },
                );
                if (valid()) {
                    key.current = null;
                    await load();
                }
            });
        },
        disconnect: () => {
            execute("disconnect", async (valid) => {
                await api.post(
                    `${GOOGLE}/disconnect`,
                    {},
                    { idempotencyKey: mutationKey("disconnect") },
                );
                if (valid()) {
                    key.current = null;
                    setPage(null);
                    await load();
                }
            });
        },
        summary:
            page === null
                ? ""
                : s.googleSummary(
                      page.average_rating === null ? s.noRating : formatRating(page.average_rating),
                      page.total_count,
                  ),
        reviews:
            (sameScope ? page : null)?.reviews.map((review) => ({
                ...review,
                author:
                    review.reviewer.anonymous || !review.reviewer.display_name
                        ? s.anonymous
                        : review.reviewer.display_name,
                stars: STARS[review.star_rating],
                date: formatDate(parseTimestamp(review.update_time), zone),
            })) ?? [],
        moreReviews: page?.next_page_token !== null && page?.next_page_token !== undefined,
        loadMore: () => {
            execute("more", async (valid) => {
                const next = await api.get<GoogleReviewPage>(
                    `${GOOGLE}/reviews?page_token=${encodeURIComponent(page?.next_page_token ?? "")}`,
                );
                if (valid())
                    setPage({
                        ...next,
                        reviews: Array.from(
                            new Map(
                                [...(page?.reviews ?? []), ...next.reviews].map((review) => [
                                    review.review_id,
                                    review,
                                ]),
                            ).values(),
                        ),
                    });
            });
        },
        reply: sameScope ? reply : null,
        comment: sameScope ? comment : "",
        setComment,
        editReply: (review: GoogleReview) => {
            setReply(review);
            setComment(review.reply?.comment ?? "");
            setError(null);
        },
        closeReply: () => {
            if (busy !== "reply") {
                setReply(null);
                setComment("");
                setConfirm(null);
            }
        },
        sendReply: () => {
            postReply(false);
        },
        deleteReply: () => {
            postReply(true);
        },
    };
}
