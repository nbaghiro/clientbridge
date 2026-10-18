// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiLike } from "../api";
import { type InboxThread, resolveInboxTarget, useThreadComposer } from "./messaging";

const threads = [
    { id: "sms-1", client_id: "client-1" },
    { id: "email-1", client_id: "client-1" },
];

describe("inbox navigation", () => {
    it("opens the notification's exact thread when a client has multiple channels", () => {
        expect(resolveInboxTarget(threads, { threadId: "email-1", clientId: "client-1" })).toEqual({
            threadId: "email-1",
            clientId: null,
        });
    });
    it("opens the client's most recent conversation", () => {
        expect(resolveInboxTarget(threads, { clientId: "client-1" })).toEqual({
            threadId: "sms-1",
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

it("retries a message with the same key after an ambiguous transport failure", async () => {
    const post = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("lost response"))
        .mockResolvedValue({});
    const api: ApiLike = { get: vi.fn(), getText: vi.fn(), post, patch: vi.fn(), delete: vi.fn() };
    const thread: InboxThread = {
        id: "th_1",
        client_id: "cl_1",
        channel: "sms",
        status: "open",
        client_name: "Pat",
        phone: null,
        email: null,
        last_message_at: null,
        unread_count: 0,
        last_body: null,
        subject_names: null,
        title: "Pat",
        ago: "",
        subjects: [],
        textsOff: false,
        channelKind: "sms",
    };
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
