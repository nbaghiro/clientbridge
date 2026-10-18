// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ApiLike } from "../api";
import { type ReviewQueue, useReviewSettings, useRequestReview } from "./reviews";

afterEach(cleanup);

const queue: ReviewQueue = {
    load: { state: "ready", ready: true, hasData: true, retrying: false, retry: vi.fn() },
    requests: [],
    suggestions: [],
    clientOptions: [],
    googleUrl: "https://g.page/r/example/review",
};
const post = vi.fn().mockResolvedValue({});
const patch = vi.fn().mockResolvedValue({});
const api: ApiLike = {
    get: vi.fn(),
    getText: vi.fn(),
    post,
    patch,
    delete: vi.fn(),
};

it("preserves an untouched saved Google URL and permits explicit clearing", async () => {
    const { result } = renderHook(() => useReviewSettings(api, queue));
    act(() => {
        result.current.saveGoogleUrl();
    });
    await waitFor(() => {
        expect(result.current.savedGoogle).toBe(true);
    });
    expect(patch).toHaveBeenLastCalledWith("/v1/business", {
        google_review_url: queue.googleUrl,
    });
    act(() => {
        result.current.setGoogleUrl("");
    });
    act(() => {
        result.current.saveGoogleUrl();
    });
    await waitFor(() => {
        expect(result.current.savedGoogle).toBe(true);
    });
    expect(patch).toHaveBeenLastCalledWith("/v1/business", { google_review_url: "" });
});

it("associates an invitation with the completed booking without fabricating feedback", async () => {
    const { result } = renderHook(() => useRequestReview(api));
    act(() => {
        result.current.request("cl_1", "bk_1");
    });
    await waitFor(() => {
        expect(result.current.sent.has("bk_1")).toBe(true);
    });
    expect(result.current.sent.has("cl_1")).toBe(false);
    expect(post.mock.lastCall?.[0]).toBe("/v1/reviews/request");
    expect(post.mock.lastCall?.[1]).toEqual({ client_id: "cl_1", booking_id: "bk_1" });
    expect(post.mock.lastCall?.[2]).toHaveProperty("idempotencyKey");
});
