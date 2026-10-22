// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import {
    type AdminAccess,
    type AdminSchemas,
    adminEditionOptions,
    useAdminAccess,
    useAdminEditionForm,
    useAdminEmailForm,
    useAdminResource,
} from "./admin";

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

it("retries an email with the same request key and blocks simultaneous sends", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init: RequestInit) => {
            requests.push(typeof init.body === "string" ? init.body : "");
            return requests.length === 1
                ? Promise.reject(new TypeError("response lost"))
                : Promise.resolve(
                      new Response(JSON.stringify({ delivery_id: "dlv_test", state: "accepted" })),
                  );
        }),
    );
    const { result } = renderHook(() => useAdminEmailForm("http://api.test"));
    act(() => {
        result.current.setRecipient("test@example.ca");
        result.current.setConfirmed(true);
    });
    act(() => {
        result.current.send("receipt", "smtp");
        result.current.send("receipt", "smtp");
    });
    await waitFor(() => {
        expect(result.current.busy).toBe(false);
    });
    expect(requests).toHaveLength(1);
    act(() => {
        result.current.setConfirmed(true);
    });
    act(() => {
        result.current.send("receipt", "smtp");
    });
    await waitFor(() => {
        expect(result.current.outcome).toBe("accepted");
    });
    expect(requests[1]).toBe(requests[0]);
});

it("does not report queued mail as accepted", async () => {
    vi.stubGlobal(
        "fetch",
        vi
            .fn()
            .mockResolvedValue(
                new Response(JSON.stringify({ delivery_id: "dlv_test", state: "queued" })),
            ),
    );
    const { result } = renderHook(() => useAdminEmailForm("http://api.test"));
    act(() => {
        result.current.setRecipient("test@example.ca");
        result.current.setConfirmed(true);
    });
    act(() => {
        result.current.send("receipt", "smtp");
    });
    await waitFor(() => {
        expect(result.current.outcome).toBe("queued");
    });
});

it("saves a business's edition and shows what the server stored", async () => {
    const business = { id: "bz_one", subject: "pet" } as AdminSchemas["AdminBusiness"];
    const requests: { url: string; body: string }[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn((url: string, init: RequestInit) => {
            requests.push({ url, body: typeof init.body === "string" ? init.body : "" });
            return Promise.resolve(new Response(JSON.stringify({ ...business, subject: null })));
        }),
    );
    const { result } = renderHook(() => useAdminEditionForm("http://api.test", business));
    expect(result.current.current).toBe("pet");
    expect(result.current.changed).toBe(false);
    act(() => {
        result.current.setValue("none");
    });
    expect(result.current.changed).toBe(true);
    act(() => {
        result.current.save();
    });
    await waitFor(() => {
        expect(result.current.outcome).toBe("saved");
    });
    expect(requests).toEqual([
        {
            url: "http://api.test/admin/v1/businesses/bz_one/edition",
            body: JSON.stringify({ subject: null }),
        },
    ]);
    expect(result.current.current).toBe("none");
    expect(result.current.changed).toBe(false);
    expect(adminEditionOptions().map((option) => option.label)).toEqual([
        "Pets",
        "Students",
        "Properties",
        "Sites",
        "Vehicles",
        "Client only",
    ]);
});

it("reports a failed edition save", async () => {
    const business = { id: "bz_one", subject: null } as AdminSchemas["AdminBusiness"];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    const { result } = renderHook(() => useAdminEditionForm("http://api.test", business));
    act(() => {
        result.current.setValue("site");
    });
    act(() => {
        result.current.save();
    });
    await waitFor(() => {
        expect(result.current.outcome).toBe("failed");
    });
    expect(result.current.current).toBe("none");
});
