import { useEffect, useState } from "react";

import type { ApiLike } from "../api";

type Schemas = import("@clientbridge/api-client").components["schemas"];
export type OutgoingPreview = Schemas["OutgoingPreview"];

export interface ReviewDocument {
    kind: "invoice" | "estimate";
    id: string;
}

export interface ReviewRequest {
    title: string;
    confirmLabel: string;
    // What happens besides the message, such as a card being charged.
    message?: string | undefined;
    // The message exactly as the client gets it, read from the server before anything is sent.
    load?: (() => Promise<OutgoingPreview>) | undefined;
    document?: ReviewDocument | undefined;
    // A second way to go ahead, such as moving a visit without telling the client.
    alternate?: string | undefined;
    destructive?: boolean | undefined;
}

export type ReviewChoice = "confirm" | "alternate";

type ReviewHost = (request: ReviewRequest) => Promise<ReviewChoice | null>;

let host: ReviewHost | null = null;

export function registerReviewHost(next: ReviewHost): () => void {
    host = next;
    return () => {
        if (host === next) host = null;
    };
}

/** Asks the person to look before anything leaves the app; with no host mounted the answer is no. */
export function review(request: ReviewRequest): Promise<ReviewChoice | null> {
    return host === null ? Promise.resolve(null) : host(request);
}

/** Runs `go` once the person has looked and chosen to go ahead; cancelling does nothing. */
export function afterReview(request: ReviewRequest, go: (choice: ReviewChoice) => void): void {
    review(request)
        .then((choice) => {
            if (choice !== null) go(choice);
        })
        .catch(() => undefined);
}

const get = (api: ApiLike, path: string) => () => api.get<OutgoingPreview>(`/v1/previews/${path}`);
const query = (params: Record<string, string>): string => new URLSearchParams(params).toString();

export const outgoing = {
    invoiceSend: (api: ApiLike, id: string) => get(api, `invoices/${id}/send`),
    invoiceRemind: (api: ApiLike, id: string) => get(api, `invoices/${id}/remind`),
    estimateSend: (api: ApiLike, id: string) => get(api, `estimates/${id}/send`),
    orderReceipt: (api: ApiLike, id: string, channel: "email" | "sms", to: string) =>
        get(api, `orders/${id}/receipt?${query({ channel, to })}`),
    orderReady: (api: ApiLike, id: string) => get(api, `orders/${id}/ready`),
    bookingDeparted: (api: ApiLike, id: string) => get(api, `bookings/${id}/departed`),
    bookingRescheduled: (api: ApiLike, id: string, startsAt: string, endsAt: string) =>
        get(api, `bookings/${id}/rescheduled?${query({ starts_at: startsAt, ends_at: endsAt })}`),
    signatureResend: (api: ApiLike, id: string) => get(api, `signatures/${id}/resend`),
    formSend: (api: ApiLike, id: string, clientId: string) =>
        get(api, `forms/${id}/send?${query({ client_id: clientId })}`),
    contractSend: (api: ApiLike, id: string, clientId: string) =>
        get(api, `contracts/${id}/send?${query({ client_id: clientId })}`),
    reviewRequest: (api: ApiLike, clientId: string) =>
        get(api, `reviews/request?${query({ client_id: clientId })}`),
};

export function useOutgoingPreview(request: ReviewRequest): {
    data: OutgoingPreview | null;
    loading: boolean;
    failed: boolean;
    retry: () => void;
} {
    const [attempt, setAttempt] = useState(0);
    const [data, setData] = useState<OutgoingPreview | null>(null);
    const [loading, setLoading] = useState(request.load !== undefined);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        if (request.load === undefined) return;
        let live = true;
        setLoading(true);
        setFailed(false);
        request
            .load()
            .then((next) => {
                if (live) setData(next);
            })
            .catch(() => {
                if (live) setFailed(true);
            })
            .finally(() => {
                if (live) setLoading(false);
            });
        return () => {
            live = false;
        };
    }, [request, attempt]);
    return {
        data,
        loading,
        failed,
        retry: () => {
            setAttempt((n) => n + 1);
        },
    };
}
