import { afterEach, describe, expect, it, vi } from "vitest";
import { createSession, type TokenPair } from "./session";
import { SessionEpoch } from "./epochs";
import { sessionIdentity } from "./identity";

function token(subject: string, suffix = ""): string {
    return `header.${btoa(JSON.stringify({ sub: subject }))}.${suffix}`;
}

function setup() {
    let saved: TokenPair | null = { access_token: token("first"), refresh_token: "old" };
    const epoch = new SessionEpoch();
    const signedOut = vi.fn();
    const api = createSession({
        baseUrl: "https://api.test",
        epoch,
        store: {
            get: () => Promise.resolve(saved),
            set: (tokens) => {
                saved = tokens;
                return Promise.resolve();
            },
            clear: () => {
                saved = null;
                return Promise.resolve();
            },
        },
        onSignedOut: signedOut,
    });
    return {
        api,
        epoch,
        signedOut,
        get: () => saved,
        replace: (tokens: TokenPair) => {
            epoch.advance();
            saved = tokens;
        },
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe("session recovery", () => {
    it("shares one refresh across simultaneous failures", async () => {
        const state = setup();
        let refreshes = 0;
        vi.stubGlobal(
            "fetch",
            vi.fn((_url: string, init?: RequestInit) => {
                if (_url.endsWith("/auth/refresh")) {
                    refreshes++;
                    return Promise.resolve(
                        Response.json({
                            access_token: token("first", "new"),
                            refresh_token: "new",
                        }),
                    );
                }
                const auth = new Headers(init?.headers).get("Authorization");
                return Promise.resolve(
                    auth === `Bearer ${token("first", "new")}`
                        ? Response.json({ ok: true })
                        : new Response(null, { status: 401 }),
                );
            }),
        );
        const result = await Promise.all([state.api.get("/one"), state.api.get("/two")]);
        expect(result).toEqual([{ ok: true }, { ok: true }]);
        expect(refreshes).toBe(1);
    });

    it("cannot overwrite a replacement login with a late refresh", async () => {
        const state = setup();
        let release: (response: Response) => void = () => undefined;
        let started: () => void = () => undefined;
        const refreshing = new Promise<void>((resolve) => {
            started = resolve;
        });
        vi.stubGlobal(
            "fetch",
            vi.fn((url: string) => {
                if (url.endsWith("/auth/refresh")) {
                    started();
                    return new Promise<Response>((resolve) => {
                        release = resolve;
                    });
                }
                return Promise.resolve(new Response(null, { status: 401 }));
            }),
        );
        const request = state.api.get("/one").catch((error: unknown) => error);
        await refreshing;
        const replacement = { access_token: token("second"), refresh_token: "second" };
        state.replace(replacement);
        release(Response.json({ access_token: token("first", "new"), refresh_token: "new" }));
        expect(await request).toBeInstanceOf(Error);
        expect(state.get()).toEqual(replacement);
        expect(state.signedOut).not.toHaveBeenCalled();
    });

    it("refuses to upload an old replica with a different actor's credentials", async () => {
        const state = setup();
        const transport = vi.fn();
        vi.stubGlobal("fetch", transport);
        state.replace({ access_token: token("second"), refresh_token: "second" });
        await expect(state.api.authFetchFor("first")("/sync/upload")).rejects.toThrow(
            "identity changed",
        );
        expect(transport).not.toHaveBeenCalled();
    });

    it("pauses once on definitive refresh rejection", async () => {
        const state = setup();
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response(null, { status: 401 }))),
        );
        await expect(state.api.get("/one")).rejects.toThrow();
        expect(state.get()).toBeNull();
        expect(state.signedOut).toHaveBeenCalledTimes(1);
    });

    it("bounds a stalled refresh and preserves credentials", async () => {
        vi.useFakeTimers();
        const state = setup();
        vi.stubGlobal(
            "fetch",
            vi.fn((url: string, init?: RequestInit) => {
                if (!url.endsWith("/auth/refresh"))
                    return Promise.resolve(new Response(null, { status: 401 }));
                return new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener("abort", () => {
                        reject(new Error("aborted"));
                    });
                });
            }),
        );
        const request = state.api.get("/one").catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(15_001);
        expect(await request).toBeInstanceOf(Error);
        expect(state.get()?.refresh_token).toBe("old");
        expect(state.signedOut).not.toHaveBeenCalled();
    });
});

it("persists one refresh attempt across a lost response and a new session instance", async () => {
    let saved: TokenPair | null = { access_token: token("first"), refresh_token: "old" };
    const store = {
        get: () => Promise.resolve(saved),
        set: (tokens: TokenPair) => {
            saved = tokens;
            return Promise.resolve();
        },
        clear: () => {
            saved = null;
            return Promise.resolve();
        },
    };
    const bodies: string[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn((url: string, init?: RequestInit) => {
            if (url.endsWith("/auth/refresh")) {
                if (typeof init?.body !== "string") throw new Error("missing refresh body");
                bodies.push(init.body);
                if (bodies.length === 1) return Promise.reject(new Error("response lost"));
                return Promise.resolve(
                    Response.json({ access_token: token("first", "new"), refresh_token: "new" }),
                );
            }
            return Promise.resolve(
                saved?.refresh_token === "new"
                    ? Response.json({ ok: true })
                    : new Response(null, { status: 401 }),
            );
        }),
    );
    const first = createSession({
        baseUrl: "https://api.test",
        store,
        onSignedOut: () => undefined,
    });
    await expect(first.get("/one")).rejects.toThrow();
    expect((await store.get())?.refresh_attempt_id).toMatch(/^[a-f0-9-]{36}$/);
    const reopened = createSession({
        baseUrl: "https://api.test",
        store,
        onSignedOut: () => undefined,
    });
    expect(await reopened.get("/one")).toEqual({ ok: true });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
    expect((await store.get())?.refresh_attempt_id).toBeUndefined();
});

it("keeps the command's business context across refresh and another selection", async () => {
    const state = setup();
    const first = state.api.forBusiness("bz_first");
    const second = state.api.forBusiness("bz_second");
    const seen: string[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn((url: string, init?: RequestInit) => {
            if (url.endsWith("/auth/refresh"))
                return Promise.resolve(
                    Response.json({ access_token: token("first", "new"), refresh_token: "new" }),
                );
            const headers = new Headers(init?.headers);
            seen.push(headers.get("X-Business-Id") ?? "missing");
            return Promise.resolve(
                headers.get("Authorization") === `Bearer ${token("first", "new")}`
                    ? Response.json({ ok: true })
                    : new Response(null, { status: 401 }),
            );
        }),
    );
    await first.post("/v1/clients", { name: "First business" });
    await second.post("/v1/clients", { name: "Second business" });
    expect(seen).toEqual(["bz_first", "bz_first", "bz_second"]);
});

describe("session identity", () => {
    it("requires a family and distinguishes a new login from token rotation", () => {
        const make = (sid: string, suffix: string) =>
            `header.${btoa(JSON.stringify({ sub: "user", sid }))}.${suffix}`;
        expect(sessionIdentity(token("user"))).toBeNull();
        expect(sessionIdentity(make("", "old"))).toBeNull();
        expect(sessionIdentity(make("one", "old"))).toBe(sessionIdentity(make("one", "rotated")));
        expect(sessionIdentity(make("one", "old"))).not.toBe(sessionIdentity(make("two", "new")));
    });
});

it("accepts a successful command with no response body", async () => {
    vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );
    const { api } = setup();
    await expect(api.delete<undefined>("/v1/resources/removed")).resolves.toBeUndefined();
    await expect(
        api.post<undefined>("/auth/logout", { refresh_token: "old" }),
    ).resolves.toBeUndefined();
});
