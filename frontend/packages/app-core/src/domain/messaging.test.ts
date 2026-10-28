// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiLike } from "../api";
import { strings } from "../strings";
import { type InboxThread, resolveInboxTarget, useThreadComposer } from "./messaging";

const threads = [
    { id: "thread-1", client_id: "client-1" },
    { id: "thread-3", client_id: "client-3" },
];

describe("inbox navigation", () => {
    it("opens the notification's exact thread", () => {
        expect(resolveInboxTarget(threads, { threadId: "thread-3", clientId: "client-3" })).toEqual(
            {
                threadId: "thread-3",
                clientId: null,
            },
        );
    });
    it("opens the client's most recent conversation", () => {
        expect(resolveInboxTarget(threads, { clientId: "client-1" })).toEqual({
            threadId: "thread-1",
            clientId: null,
        });
    });
    it("prefills a new draft only after no existing client conversation is found", () => {
        expect(resolveInboxTarget(threads, { clientId: "client-2" })).toEqual({
            threadId: null,
            clientId: "client-2",
        });
        expect(resolveInboxTarget([], { clientId: "client-2" })).toEqual({
            threadId: null,
            clientId: "client-2",
        });
    });
    it("does not turn a missing notification thread into a draft or unrelated conversation", () => {
        expect(resolveInboxTarget(threads, { threadId: "missing", clientId: "client-1" })).toEqual({
            threadId: null,
            clientId: null,
        });
        expect(resolveInboxTarget(threads, {})).toEqual({ threadId: null, clientId: null });
    });
});

afterEach(cleanup);

const thread: InboxThread = {
    id: "th_1",
    client_id: "cl_1",
    status: "open",
    client_name: "Pat",
    phone: null,
    last_message_at: null,
    unread_count: 0,
    last_body: null,
    subject_names: null,
    title: "Pat",
    ago: "",
    subjects: [],
    textsOff: false,
};

function apiWith(post: ApiLike["post"]): ApiLike {
    return { get: vi.fn(), getText: vi.fn(), post, patch: vi.fn(), delete: vi.fn() };
}

it("retries a message with the same key after an ambiguous transport failure", async () => {
    const post = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("lost response"))
        .mockResolvedValue({ status: "sent" });
    const api = apiWith(post);
    const { result } = renderHook(() => useThreadComposer(api, thread));
    act(() => {
        result.current.setBody("Hello");
    });
    act(() => {
        result.current.submit();
    });
    await waitFor(() => {
        expect(result.current.error).not.toBeNull();
    });
    act(() => {
        result.current.submit();
    });
    await waitFor(() => {
        expect(result.current.body).toBe("");
    });
    expect(post.mock.calls[1]).toEqual(post.mock.calls[0]);
    act(() => {
        result.current.setBody("Hello");
    });
    act(() => {
        result.current.submit();
    });
    await waitFor(() => {
        expect(post).toHaveBeenCalledTimes(3);
    });
    expect(post.mock.calls[2]?.[2]).not.toEqual(post.mock.calls[0]?.[2]);
});

it("keeps the draft and says so when the provider refused the message", async () => {
    const post = vi
        .fn()
        .mockResolvedValueOnce({ status: "failed" })
        .mockResolvedValue({ status: "sent" });
    const { result } = renderHook(() => useThreadComposer(apiWith(post), thread));
    act(() => {
        result.current.setBody("Hello");
    });
    act(() => {
        result.current.submit();
    });
    await waitFor(() => {
        expect(result.current.error).toBe(strings.messaging.notDelivered);
    });
    expect(result.current.body).toBe("Hello");
    act(() => {
        result.current.submit();
    });
    await waitFor(() => {
        expect(result.current.body).toBe("");
    });
    expect(result.current.error).toBeNull();
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1]?.[2]).not.toEqual(post.mock.calls[0]?.[2]);
});
