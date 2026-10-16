// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { type AdminAccess, useAdminAccess, useAdminResource } from "./admin";

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function pending() {
    let resolve: (value: AdminAccess) => void = () => undefined;
    const promise = new Promise<AdminAccess>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function subscription() {
    let refresh: () => void = () => undefined;
    const subscribe = (listener: () => void) => {
        refresh = listener;
        return () => undefined;
    };
    return {
        subscribe,
        refresh: () => {
            refresh();
        },
    };
}

it("does not grant initial access before the server responds", async () => {
    const request = pending();
    const check = () => request.promise;
    const events = subscription();
    const { result } = renderHook(() => useAdminAccess(check, events.subscribe));
    expect(result.current).toBe("loading");
    await act(async () => {
        request.resolve("signedOut");
        await request.promise;
    });
    expect(result.current).toBe("signedOut");
});

it("keeps a verified screen mounted during revalidation and removes revoked access", async () => {
    const request = pending();
    const check = vi
        .fn<() => Promise<AdminAccess>>()
        .mockResolvedValueOnce("allowed")
        .mockReturnValueOnce(request.promise);
    const events = subscription();
    const { result } = renderHook(() => useAdminAccess(check, events.subscribe));
    await waitFor(() => {
        expect(result.current).toBe("allowed");
    });
    act(events.refresh);
    expect(result.current).toBe("allowed");
    await act(async () => {
        request.resolve("denied");
        await request.promise;
    });
    expect(result.current).toBe("denied");
});

it("ignores an old successful check after a newer signed-out result", async () => {
    const old = pending();
    const check = vi
        .fn<() => Promise<AdminAccess>>()
        .mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce("signedOut");
    const events = subscription();
    const { result } = renderHook(() => useAdminAccess(check, events.subscribe));
    act(events.refresh);
    await waitFor(() => {
        expect(result.current).toBe("signedOut");
    });
    await act(async () => {
        old.resolve("allowed");
        await old.promise;
    });
    expect(result.current).toBe("signedOut");
});

it("does not show an earlier record after navigating to a different record", async () => {
    let finish: (response: Response) => void = () => undefined;
    const first = new Promise<Response>((resolve) => {
        finish = resolve;
    });
    vi.stubGlobal(
        "fetch",
        vi
            .fn()
            .mockReturnValueOnce(first)
            .mockResolvedValueOnce(new Response(JSON.stringify({ identity_id: "new" }))),
    );
    const { result, rerender } = renderHook(
        ({ path }) => useAdminResource("AdminSession", "http://api.test", path),
        { initialProps: { path: "first" } },
    );
    rerender({ path: "second" });
    await waitFor(() => {
        expect(result.current.data?.identity_id).toBe("new");
    });
    await act(async () => {
        finish(new Response(JSON.stringify({ identity_id: "old" })));
        await first;
    });
    expect(result.current.data?.identity_id).toBe("new");
});

it("clears protected records when a refresh denies access", async () => {
    vi.stubGlobal(
        "fetch",
        vi
            .fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ identity_id: "operator" })))
            .mockResolvedValueOnce(new Response(null, { status: 403 })),
    );
    const { result } = renderHook(() =>
        useAdminResource("AdminSession", "http://api.test", "session"),
    );
    await waitFor(() => {
        expect(result.current.data?.identity_id).toBe("operator");
    });
    act(() => {
        result.current.refresh();
    });
    await waitFor(() => {
        expect(result.current.error).toBe(403);
    });
    expect(result.current.data).toBeNull();
});
