import { useState } from "react";

import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import { type PublicBrand, usePublicResource } from "./publicResource";

interface PublicReviewContext {
    business_name: string;
    brand: PublicBrand;
    completed: boolean;
    rating: number | null;
    first_name: string | null;
    pet: string | null;
    service: string | null;
    staff: string | null;
    google_review_url: string | null;
    published: boolean;
}

interface PublicReviewSubmit {
    rating: number;
    body?: string | null;
}

class PublicReviewError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "PublicReviewError";
    }
}

interface PublicReviewClient {
    getContext: (token: string) => Promise<PublicReviewContext>;
    submit(token: string, input: PublicReviewSubmit): Promise<PublicReviewContext>;
}

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

type ReviewPageStage =
    "loading" | "error" | "not-found" | "rate" | "thanks-public" | "thanks-private";

export interface ReviewPage {
    stage: ReviewPageStage;
    context: PublicReviewContext | null;
    rating: number;
    setRating: (n: number) => void;
    // Four or five stars; anything lower stays private until the business publishes it.
    positive: boolean;
    body: string;
    setBody: (v: string) => void;
    submit: () => void;
    busy: boolean;
    error: string | null;
    retry: () => void;
}

const POSITIVE_FROM = 4;

/** The thanks screen follows what the server did: a published review is offered to Google. */
export function useReviewPage(reviews: PublicReviewClient, token: string): ReviewPage {
    const { status, data, setData, retry } = usePublicResource(reviews.getContext, token);
    const [rating, setRatingState] = useState(0);
    const [body, setBody] = useState("");
    const { busy, error, setError, run } = useAsyncAction();
    const stage: ReviewPageStage =
        status !== "ready" || data === null
            ? status === "ready"
                ? "error"
                : status
            : !data.completed
              ? "rate"
              : data.published
                ? "thanks-public"
                : "thanks-private";

    return {
        stage,
        context: data,
        rating,
        setRating: (n) => {
            setRatingState(n);
            setError(null);
        },
        positive: rating >= POSITIVE_FROM,
        body,
        setBody,
        submit: () => {
            if (rating < 1) {
                setError(strings.publicReview.pickRating);
                return;
            }
            run(
                async () => {
                    setData(await reviews.submit(token, { rating, body: body.trim() || null }));
                },
                { errorMessage: strings.publicReview.submitError },
            );
        },
        busy,
        error,
        retry,
    };
}
