// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiLike } from "../api";
import { strings } from "../strings";
import {
    INBOX_SQL,
    type InboxThread,
    resolveInboxTarget,
    textLengthError,
    useConversation,
    useInbox,
    useThreadComposer,
} from "./messaging";

const inboxRows = [
    { id: "th_ann", client_name: "Ann Lee", unread_count: 2, last_body: "Running late" },
    { id: "th_bo", client_name: "Bo Diaz", unread_count: 1, last_body: "See you then" },
    { id: "th_cy", client_name: "Cy Park", unread_count: 0, last_body: "Thanks Ann" },
].map((r) => ({
    ...r,
    client_id: `cl_${r.id}`,
    created_at: "2026-10-01T12:00:00Z",
    status: "open",
    phone: null,
    last_message_at: null,
    subject_names: null,
}));

vi.mock("../hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../hooks")>()),
    useBusinessQuery: (sql: string) => ({ data: sql === INBOX_SQL ? inboxRows : [] }),
}));

vi.mock("../datetime", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../datetime")>()),
    useBusinessZone: () => "America/Toronto",
}));

vi.mock("./sync", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./sync")>()),
    useReplicaLoad: () => ({ state: "ready" }),
}));

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
    created_at: new Date().toISOString(),
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

describe("earlier messages", () => {
    it("are not offered for a thread that began within the history this device keeps", () => {
        const { result } = renderHook(() => useConversation(apiWith(vi.fn()), thread));
        expect(result.current.earlier.show).toBe(false);
    });

    it("are offered for an older thread until the server says there are none left", async () => {
        const get = vi.fn(() => Promise.resolve({ messages: [], more: false }));
        const api = { ...apiWith(vi.fn()), get } as unknown as ApiLike;
        const old = { ...thread, created_at: "2020-01-01T00:00:00Z" };
        const { result } = renderHook(() => useConversation(api, old));
        expect(result.current.earlier.show).toBe(true);
        act(() => {
            result.current.earlier.load();
        });
        await waitFor(() => {
            expect(result.current.earlier.show).toBe(false);
        });
        expect(get).toHaveBeenCalledOnce();
    });

    it("are offered again once a merge moves the thread's start before the device's history", () => {
        const { result, rerender } = renderHook(
            ({ t }: { t: InboxThread }) => useConversation(apiWith(vi.fn()), t),
            { initialProps: { t: thread } },
        );
        expect(result.current.earlier.show).toBe(false);
        rerender({ t: { ...thread, created_at: "2020-01-01T00:00:00Z" } });
        expect(result.current.earlier.show).toBe(true);
    });
});

describe("inbox unread count", () => {
    it("counts only the unread conversations the search matches", () => {
        const { result } = renderHook(() => useInbox());
        expect(result.current.unread).toBe(2);
        act(() => {
            result.current.setQ("ann");
        });
        expect(result.current.filtered.map((t) => t.id)).toEqual(["th_ann", "th_cy"]);
        expect(result.current.unread).toBe(1);
        act(() => {
            result.current.setQ("nobody");
        });
        expect(result.current.unread).toBe(0);
    });

    it("keeps the same count under the unread filter", () => {
        const { result } = renderHook(() => useInbox());
        act(() => {
            result.current.setQ("ann");
            result.current.setFilter("unread");
        });
        expect(result.current.unread).toBe(1);
    });
});

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

it("refuses a text longer than the server takes, without sending it", () => {
    const post = vi.fn();
    const { result } = renderHook(() => useThreadComposer(apiWith(post), thread));
    act(() => {
        result.current.setBody("a".repeat(1001));
    });
    act(() => {
        result.current.submit();
    });
    expect(result.current.error).toBe(strings.messaging.tooLong(1000, 1001));
    expect(result.current.body).toHaveLength(1001);
    expect(post).not.toHaveBeenCalled();
});

it("counts an emoji as one character, as the server does", () => {
    expect(textLengthError(`  ${"🙂".repeat(1000)}  `)).toBeNull();
    expect(textLengthError("🙂".repeat(1001))).toBe(strings.messaging.tooLong(1000, 1001));
});
