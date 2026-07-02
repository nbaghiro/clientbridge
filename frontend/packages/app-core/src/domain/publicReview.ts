// Unauthenticated review client. The URL token is the only credential, so these hit the API with a
// plain `fetch` (never the authed session) against a base URL each platform supplies. PowerSync-free
// so it can ship in the lean Connect bundle (`@clientbridge/app-core/public`).

import { useEffect, useState } from "react";

import { useAsyncAction } from "../hooks/useAsyncAction";
import { strings } from "../strings";
import type { PublicBrand } from "./publicBrand";

export interface PublicReviewContext {
    business_name: string;
    brand: PublicBrand;
    completed: boolean;
    rating: number | null;
}

export interface PublicReviewSubmit {
    rating: number;
    body?: string | null;
}

export class PublicReviewError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "PublicReviewError";
    }
}

export interface PublicReviewClient {
    getContext(token: string): Promise<PublicReviewContext>;
    submit(token: string, input: PublicReviewSubmit): Promise<PublicReviewContext>;
}

/** Build a review client bound to the API origin (web `VITE_API_URL`), mirroring
 *  `createPublicPayClient`. */
export function createPublicReviewClient(baseUrl: string): PublicReviewClient {
    const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
        const res = await fetch(`${baseUrl}${path}`, init);
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new PublicReviewError(res.status, text || res.statusText);
        }
        return (await res.json()) as T;
    };

    return {
        getContext: (token) => request<PublicReviewContext>(`/review/${encodeURIComponent(token)}`),
        submit: (token, input) =>
            request<PublicReviewContext>(`/review/${encodeURIComponent(token)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rating: input.rating, body: input.body ?? null }),
            }),
    };
}

export type PublicReviewStatus = "loading" | "not-found" | "error" | "done" | "ready";

export interface PublicReviewForm {
    status: PublicReviewStatus;
    context: PublicReviewContext | null;
    rating: number; // 0 = none selected yet
    setRating: (r: number) => void;
    body: string;
    setBody: (b: string) => void;
    submit: () => void;
    busy: boolean;
    error: string | null;
    setError: (message: string | null) => void;
}

/** View-model for the public review page: load the request context, capture a 1–5 rating + optional
 *  note, then submit. The star picker + textarea render per-platform. */
export function usePublicReview(reviews: PublicReviewClient, token: string): PublicReviewForm {
    const [context, setContext] = useState<PublicReviewContext | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [rating, setRating] = useState(0);
    const [body, setBody] = useState("");
    const { busy, error, setError, run } = useAsyncAction();

    useEffect(() => {
        let live = true;
        setLoading(true);
        reviews
            .getContext(token)
            .then((c) => {
                if (live) setContext(c);
            })
            .catch((err: unknown) => {
                if (!live) return;
                if (err instanceof PublicReviewError && err.status === 404) setNotFound(true);
                else setLoadError(true);
            })
            .finally(() => {
                if (live) setLoading(false);
            });
        return () => {
            live = false;
        };
    }, [reviews, token]);

    const status: PublicReviewStatus = loading
        ? "loading"
        : notFound
          ? "not-found"
          : loadError || context === null
            ? "error"
            : context.completed
              ? "done"
              : "ready";

    const submit = (): void => {
        if (rating < 1) {
            setError(strings.publicReview.pickRating);
            return;
        }
        void run(
            async () => {
                setContext(await reviews.submit(token, { rating, body: body.trim() || null }));
            },
            { errorMessage: strings.publicReview.submitError },
        );
    };

    return {
        status,
        context,
        rating,
        setRating,
        body,
        setBody,
        submit,
        busy,
        error,
        setError,
    };
}
