// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ApiLike } from "../api";
import { BusinessZoneContext } from "../datetime";
import { strings } from "../strings";
import { useGoogleReviews, useRequestReview, useReviewAutomation } from "./reviews";

const replica = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: () => ({ data: replica.rows }),
}));

afterEach(cleanup);
const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(BusinessZoneContext.Provider, { value: "America/Toronto" }, children);
function boundary() {
    const get = vi.fn();
    const post = vi.fn().mockResolvedValue({});
    const patch = vi.fn();
    const api: ApiLike = { get, post, getText: vi.fn(), patch, delete: vi.fn() };
    return { api, get, post, patch };
}
const active = {
    state: "active",
    connection_id: "gc_1",
    generation: 1,
    location: { name: "locations/1", title: "Birch" },
    can_request: true,
};
const review = {
    review_id: "r1",
    reviewer: { display_name: "A client", anonymous: false },
    star_rating: "FIVE",
    comment: "Great",
    create_time: "2026-10-13T12:00:00Z",
    update_time: "2026-10-13T12:00:00Z",
    reply: null,
};
const page = { reviews: [review], average_rating: 5, total_count: 1, next_page_token: null };

it("requires an active Google profile before enabling invitations", async () => {
    const { api, get } = boundary();
    get.mockResolvedValue({ ...active, state: "disconnected", location: null, can_request: false });
    const { result } = renderHook(() => useGoogleReviews(api), { wrapper });
    await waitFor(() => {
        expect(result.current.loading).toBe(false);
    });
    expect(result.current.canRequest).toBe(false);
    expect(result.current.reviews).toEqual([]);
    expect(get).toHaveBeenCalledTimes(1);
});

it("loads Google reviews and deduplicates subsequent pages", async () => {
    const { api, get } = boundary();
    get.mockResolvedValueOnce(active)
        .mockResolvedValueOnce({ ...page, next_page_token: "next token" })
        .mockResolvedValueOnce({
            ...page,
            reviews: [
                review,
                { ...review, review_id: "r2", reviewer: { display_name: null, anonymous: true } },
            ],
            total_count: 2,
        });
    const { result } = renderHook(() => useGoogleReviews(api), { wrapper });
    await waitFor(() => {
        expect(result.current.connected).toBe(true);
    });
    expect(result.current.canRequest).toBe(true);
    expect(result.current.reviews[0]?.stars).toBe(5);
    act(() => {
        result.current.loadMore();
    });
    await waitFor(() => {
        expect(result.current.reviews).toHaveLength(2);
    });
    expect(get).toHaveBeenLastCalledWith("/v1/reviews/google/reviews?page_token=next%20token");
    expect(result.current.reviews[1]?.author).toBe(strings.reviews.anonymous);
});

it("drops Google content when switching businesses and ignores stale results", async () => {
    const first = boundary();
    const second = boundary();
    let resolvePage: ((value: typeof page) => void) | undefined;
    first.get.mockResolvedValueOnce(active).mockReturnValueOnce(
        new Promise<typeof page>((resolve) => {
            resolvePage = resolve;
        }),
    );
    second.get.mockResolvedValue({ ...active, state: "disconnected", can_request: false });
    const { result, rerender } = renderHook(({ api }) => useGoogleReviews(api), {
        wrapper,
        initialProps: { api: first.api },
    });
    await waitFor(() => {
        expect(first.get).toHaveBeenCalledTimes(2);
    });
    rerender({ api: second.api });
    await waitFor(() => {
        expect(result.current.loading).toBe(false);
    });
    await act(async () => {
        resolvePage?.(page);
        await Promise.resolve();
    });
    expect(result.current.reviews).toEqual([]);
    expect(result.current.canRequest).toBe(false);
});

it("keeps invitations disabled when Google reviews cannot load", async () => {
    const { api, get } = boundary();
    get.mockResolvedValueOnce(active).mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useGoogleReviews(api), { wrapper });
    await waitFor(() => {
        expect(result.current.error).toBe(strings.reviews.googleError);
    });
    expect(result.current.canRequest).toBe(false);
    expect(result.current.connected).toBe(false);
});

it("selects a Google account and location before loading its reviews", async () => {
    const { api, get, post } = boundary();
    get.mockResolvedValueOnce({ ...active, state: "selecting", can_request: false })
        .mockResolvedValueOnce({
            choices: [{ name: "accounts/1", title: "Account" }],
            next_page_token: null,
        })
        .mockResolvedValueOnce({
            choices: [{ name: "locations/1", title: "Birch" }],
            next_page_token: null,
        })
        .mockResolvedValueOnce(active)
        .mockResolvedValueOnce(page);
    const { result } = renderHook(() => useGoogleReviews(api), { wrapper });
    await waitFor(() => {
        expect(result.current.accountOptions).toHaveLength(1);
    });
    act(() => {
        result.current.chooseAccount("accounts/1");
    });
    await waitFor(() => {
        expect(result.current.locationOptions).toHaveLength(1);
    });
    act(() => {
        result.current.setLocation("locations/1");
    });
    act(() => {
        result.current.selectLocation();
    });
    await waitFor(() => {
        expect(result.current.connected).toBe(true);
    });
    expect(post.mock.lastCall?.[0]).toBe("/v1/reviews/google/location");
    expect(post.mock.lastCall?.[1]).toEqual({
        account_name: "accounts/1",
        location_name: "locations/1",
        generation: 1,
    });
    expect(post.mock.lastCall?.[2]).toHaveProperty("idempotencyKey");
});

it("retains an uncertain reply and reuses its idempotency key on retry", async () => {
    const { api, get, post } = boundary();
    get.mockResolvedValueOnce(active).mockResolvedValueOnce(page);
    post.mockResolvedValue({ id: "op1", state: "unknown" });
    const { result } = renderHook(() => useGoogleReviews(api), { wrapper });
    await waitFor(() => {
        expect(result.current.connected).toBe(true);
    });
    act(() => {
        const item = result.current.reviews[0];
        if (item) result.current.editReply(item);
    });
    act(() => {
        result.current.setComment("Thank you!");
    });
    act(() => {
        result.current.sendReply();
        result.current.sendReply();
    });
    await waitFor(() => {
        expect(result.current.busy).toBeNull();
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe(strings.reviews.replyUncertain);
    expect(result.current.comment).toBe("Thank you!");
    act(() => {
        result.current.sendReply();
    });
    await waitFor(() => {
        expect(post).toHaveBeenCalledTimes(2);
    });
    expect(post.mock.calls[1]).toEqual(post.mock.calls[0]);
});

it("only displays a changed reply after Google confirms and returns it", async () => {
    const { api, get, post } = boundary();
    get.mockResolvedValueOnce(active)
        .mockResolvedValueOnce(page)
        .mockResolvedValueOnce(active)
        .mockResolvedValueOnce({
            ...page,
            reviews: [
                { ...review, reply: { comment: "Thanks", update_time: "2026-10-13T13:00:00Z" } },
            ],
        });
    post.mockResolvedValue({ id: "op1", state: "confirmed" });
    const { result } = renderHook(() => useGoogleReviews(api), { wrapper });
    await waitFor(() => {
        expect(result.current.connected).toBe(true);
    });
    act(() => {
        const item = result.current.reviews[0];
        if (item) result.current.editReply(item);
    });
    act(() => {
        result.current.setComment("Thanks");
    });
    act(() => {
        result.current.sendReply();
    });
    await waitFor(() => {
        expect(result.current.reviews[0]?.reply?.comment).toBe("Thanks");
    });
    expect(result.current.reply).toBeNull();
});

it("associates an invitation with the completed booking without fabricating feedback", async () => {
    const { api, post } = boundary();
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

it("requires reconnection when Google revokes access", async () => {
    const { api, get } = boundary();
    get.mockResolvedValueOnce(active).mockRejectedValueOnce({ code: "google_reconnect_required" });
    const { result } = renderHook(() => useGoogleReviews(api), { wrapper });
    await waitFor(() => {
        expect(result.current.connection?.state).toBe("reconnect_required");
    });
    expect(result.current.reviews).toEqual([]);
    expect(result.current.canRequest).toBe(false);
    expect(result.current.error).toBe(strings.reviews.reconnectBody);
});

it("validates UTF-8 reply length before sending to Google", async () => {
    const { api, get, post } = boundary();
    get.mockResolvedValueOnce(active).mockResolvedValueOnce(page);
    const { result } = renderHook(() => useGoogleReviews(api), { wrapper });
    await waitFor(() => {
        expect(result.current.connected).toBe(true);
    });
    act(() => {
        const item = result.current.reviews[0];
        if (item) result.current.editReply(item);
    });
    act(() => {
        result.current.setComment("🙂".repeat(1025));
    });
    act(() => {
        result.current.sendReply();
    });
    expect(post).not.toHaveBeenCalled();
    expect(result.current.error).toBe(strings.reviews.replyInvalid);
});

it("opens Google authorization and completes the authenticated handoff", async () => {
    const { api, get, post } = boundary();
    get.mockResolvedValueOnce({ ...active, state: "disconnected", can_request: false })
        .mockResolvedValueOnce(active)
        .mockResolvedValueOnce(page);
    post.mockResolvedValueOnce({
        authorization_url: "https://accounts.google.com/o/oauth2/v2/auth?state=opaque",
        flow_token: "secret",
    }).mockResolvedValueOnce({ state: "complete" });
    const open = vi.fn();
    const close = vi.fn();
    const { result } = renderHook(() => useGoogleReviews(api), { wrapper });
    await waitFor(() => {
        expect(result.current.loading).toBe(false);
    });
    act(() => {
        result.current.connect("web", open, close);
    });
    await waitFor(
        () => {
            expect(result.current.connected).toBe(true);
        },
        { timeout: 3000 },
    );
    expect(open).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?state=opaque");
    expect(post).toHaveBeenLastCalledWith("/v1/reviews/google/authorization/complete", {
        flow_token: "secret",
    });
    expect(close).toHaveBeenCalledOnce();
});

it("disconnects without deleting Google reviews", async () => {
    const { api, get, post } = boundary();
    get.mockResolvedValueOnce(active)
        .mockResolvedValueOnce(page)
        .mockResolvedValueOnce({ ...active, state: "disconnected", can_request: false });
    const { result } = renderHook(() => useGoogleReviews(api), { wrapper });
    await waitFor(() => {
        expect(result.current.connected).toBe(true);
    });
    act(() => {
        result.current.disconnect();
    });
    await waitFor(() => {
        expect(result.current.connection?.state).toBe("disconnected");
    });
    expect(result.current.reviews).toEqual([]);
    expect(result.current.canRequest).toBe(false);
    expect(post.mock.lastCall?.[0]).toBe("/v1/reviews/google/disconnect");
});

it("saves the automatic request setting and shows it until the replica catches up", async () => {
    replica.rows = [{ review_requests_enabled: 1 }];
    const { api, patch } = boundary();
    patch.mockResolvedValue({});
    const { result, rerender } = renderHook(() => useReviewAutomation(api), { wrapper });
    expect(result.current.enabled).toBe(true);
    act(() => {
        result.current.setEnabled(false);
    });
    await waitFor(() => {
        expect(result.current.busy).toBe(false);
    });
    expect(patch).toHaveBeenCalledWith("/v1/business", { review_requests_enabled: false });
    expect(result.current.enabled).toBe(false);
    replica.rows = [{ review_requests_enabled: 0 }];
    rerender();
    expect(result.current.enabled).toBe(false);
});

it("reverts the automatic request setting when saving fails", async () => {
    replica.rows = [{ review_requests_enabled: 1 }];
    const { api, patch } = boundary();
    patch.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useReviewAutomation(api), { wrapper });
    act(() => {
        result.current.setEnabled(false);
    });
    await waitFor(() => {
        expect(result.current.error).toBe(strings.reviews.automationError);
    });
    expect(result.current.enabled).toBe(true);
});
