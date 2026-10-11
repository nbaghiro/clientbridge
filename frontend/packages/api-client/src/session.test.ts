import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createSession, type SessionCredentials } from "./session";
import { SessionEpoch } from "./epochs";
import { createIdentityClient, parseFlow } from "./identity";

function setup(mode: "cookie" | "token" = "token") {
    let saved: SessionCredentials | null = { userId: "us_first", sessionToken: "ory_st_first" };
    const epoch = new SessionEpoch();
    const signedOut = vi.fn();
    const stepUp = vi.fn();
    const api = createSession({
        baseUrl: "https://api.test",
        mode,
        epoch,
        store: {
            get: () => Promise.resolve(saved),
            clear: () => {
                saved = null;
                return Promise.resolve();
            },
        },
        onSignedOut: signedOut,
        onStepUp: stepUp,
    });
    return {
        api,
        epoch,
        signedOut,
        stepUp,
        get: () => saved,
        replace: (credentials: SessionCredentials) => {
            epoch.advance();
            saved = credentials;
        },
    };
}

function requests(): { url: string; init: RequestInit }[] {
    const seen: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn((url: string, init: RequestInit = {}) => {
            seen.push({ url, init });
            return Promise.resolve(Response.json({ ok: true }));
        }),
    );
    return seen;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("credentials", () => {
    it("sends the session token on mobile and nothing on the cookie", async () => {
        const seen = requests();
        await setup("token").api.get("/v1/me");
        await setup("cookie").api.get("/v1/me");
        const [token, cookie] = seen.map((s) => new Headers(s.init.headers));
        expect(token?.get("X-Session-Token")).toBe("ory_st_first");
        expect(seen[0]?.init.credentials).toBeUndefined();
        expect(cookie?.get("X-Session-Token")).toBeNull();
        expect(seen[1]?.init.credentials).toBe("include");
    });

    it("binds a replica's requests to its user", async () => {
        const seen = requests();
        await setup().api.authFetchFor("us_first")("/sync/token");
        expect(new Headers(seen[0]?.init.headers).get("X-Expected-User")).toBe("us_first");
    });

    it("refuses to send a replica's request after another user signed in", async () => {
        const state = setup();
        const transport = vi.fn();
        vi.stubGlobal("fetch", transport);
        state.replace({ userId: "us_second", sessionToken: "ory_st_second" });
        await expect(state.api.authFetchFor("us_first")("/v1/hours/st_first/week")).rejects.toThrow(
            "identity changed",
        );
        expect(transport).not.toHaveBeenCalled();
    });

    it("keeps each command's business context", async () => {
        const seen = requests();
        const { api } = setup();
        await api.forBusiness("bz_first").post("/v1/clients", { name: "First" });
        await api.forBusiness("bz_second").post("/v1/clients", { name: "Second" });
        expect(seen.map((s) => new Headers(s.init.headers).get("X-Business-Id"))).toEqual([
            "bz_first",
            "bz_second",
        ]);
    });
});

describe("session loss", () => {
    it("signs out once when the API says the session is gone", async () => {
        const state = setup();
        vi.stubGlobal(
            "fetch",
            vi.fn(() =>
                Promise.resolve(Response.json({ error: "unauthenticated" }, { status: 401 })),
            ),
        );
        await expect(state.api.get("/one")).rejects.toThrow(ApiError);
        expect(state.get()).toBeNull();
        expect(state.signedOut).toHaveBeenCalledTimes(1);
    });

    it("asks for a second factor instead of signing out", async () => {
        const state = setup();
        vi.stubGlobal(
            "fetch",
            vi.fn(() =>
                Promise.resolve(Response.json({ error: "aal2_required" }, { status: 401 })),
            ),
        );
        await expect(state.api.get("/one")).rejects.toThrow();
        expect(state.stepUp).toHaveBeenCalledTimes(1);
        expect(state.signedOut).not.toHaveBeenCalled();
        expect(state.get()).not.toBeNull();
    });

    it("keeps the session through an identity outage", async () => {
        const state = setup();
        vi.stubGlobal(
            "fetch",
            vi.fn(() =>
                Promise.resolve(Response.json({ error: "identity_unavailable" }, { status: 503 })),
            ),
        );
        const failure = await state.api.get("/one").catch((e: unknown) => e);
        expect(failure).toBeInstanceOf(ApiError);
        expect((failure as ApiError).code).toBe("identity_unavailable");
        expect(state.signedOut).not.toHaveBeenCalled();
    });

    it("ignores a late 401 from a session that was already replaced", async () => {
        const state = setup();
        let release: (response: Response) => void = () => undefined;
        vi.stubGlobal(
            "fetch",
            vi.fn(
                () =>
                    new Promise<Response>((resolve) => {
                        release = resolve;
                    }),
            ),
        );
        const request = state.api.get("/one").catch((error: unknown) => error);
        state.replace({ userId: "us_second", sessionToken: "ory_st_second" });
        release(Response.json({ error: "unauthenticated" }, { status: 401 }));
        expect(await request).toBeInstanceOf(Error);
        expect(state.get()?.userId).toBe("us_second");
        expect(state.signedOut).not.toHaveBeenCalled();
    });
});

it("accepts a successful command with no response body", async () => {
    vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );
    const { api } = setup();
    await expect(api.delete<undefined>("/v1/resources/removed")).resolves.toBeUndefined();
});

describe("identity client", () => {
    const flow = parseFlow("login", {
        id: "flow-1",
        ui: {
            nodes: [
                {
                    group: "default",
                    type: "input",
                    attributes: { name: "csrf_token", value: "csrf" },
                },
                {
                    group: "totp",
                    type: "img",
                    attributes: { id: "totp_qr", src: "data:image/png;base64,AA" },
                    meta: { label: { text: "QR" } },
                },
            ],
            messages: [{ id: 4000006, type: "error", text: "invalid" }],
        },
    });

    it("parses nodes and messages", () => {
        expect(flow.nodes[1]).toMatchObject({ name: "totp_qr", src: "data:image/png;base64,AA" });
        expect(flow.messages[0]?.id).toBe(4000006);
    });

    it("adds the CSRF token on browser flows and returns the session", async () => {
        const seen = requests();
        vi.stubGlobal(
            "fetch",
            vi.fn((url: string, init: RequestInit = {}) => {
                seen.push({ url, init });
                return Promise.resolve(Response.json({ session: { id: "s" } }));
            }),
        );
        const identity = createIdentityClient({ kratosUrl: "https://auth.test/", mode: "browser" });
        const step = await identity.submit(flow, { method: "password" });
        expect(step).toEqual({ kind: "done" });
        expect(seen[0]?.url).toBe("https://auth.test/self-service/login?flow=flow-1");
        expect(seen[0]?.init.credentials).toBe("include");
        expect(JSON.parse(seen[0]?.init.body as string)).toEqual({
            method: "password",
            csrf_token: "csrf",
        });
    });

    it("hands native recovery over to settings with a token", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(() =>
                Promise.resolve(
                    Response.json({
                        id: "rec",
                        state: "passed_challenge",
                        continue_with: [
                            { action: "set_ory_session_token", ory_session_token: "ory_st_x" },
                            { action: "show_settings_ui", flow: { id: "set-1" } },
                        ],
                    }),
                ),
            ),
        );
        const identity = createIdentityClient({ kratosUrl: "https://auth.test", mode: "native" });
        const step = await identity.submit(parseFlow("recovery", { id: "rec" }), {
            method: "code",
        });
        expect(step).toEqual({
            kind: "done",
            sessionToken: "ory_st_x",
            next: { flow: "settings", id: "set-1" },
        });
    });

    it("maps redirects, privileged actions and expired flows", async () => {
        const identity = createIdentityClient({ kratosUrl: "https://auth.test", mode: "browser" });
        const answer = (body: unknown, status: number) => {
            vi.stubGlobal(
                "fetch",
                vi.fn(() => Promise.resolve(Response.json(body, { status }))),
            );
        };
        answer({ redirect_browser_to: "https://accounts.google.com" }, 422);
        expect(await identity.submit(flow, {})).toEqual({
            kind: "redirect",
            url: "https://accounts.google.com",
        });
        answer({ error: { id: "session_refresh_required" } }, 403);
        expect(await identity.submit(flow, {})).toEqual({ kind: "reauth" });
        answer({ error: { id: "self_service_flow_expired" } }, 410);
        expect(await identity.submit(flow, {})).toEqual({ kind: "restart" });
        answer({ id: "flow-1", ui: { nodes: [], messages: [] } }, 400);
        expect((await identity.submit(flow, {})).kind).toBe("flow");
    });

    it("tells a missing session from one that needs a second factor", async () => {
        const identity = createIdentityClient({ kratosUrl: "https://auth.test", mode: "native" });
        vi.stubGlobal(
            "fetch",
            vi.fn(() =>
                Promise.resolve(
                    Response.json({ error: { id: "session_aal2_required" } }, { status: 403 }),
                ),
            ),
        );
        expect(await identity.session("tok")).toBe("aal2");
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(Response.json({}, { status: 401 }))),
        );
        expect(await identity.session("tok")).toBe("none");
    });
});

describe("refused requests", () => {
    it("carry the status and the body's error code, not its message", async () => {
        const state = setup();
        vi.stubGlobal(
            "fetch",
            vi.fn(() =>
                Promise.resolve(
                    Response.json(
                        { error: "invalid_timezone", message: "timezone must be an IANA name" },
                        { status: 422 },
                    ),
                ),
            ),
        );
        await expect(state.api.patch("/v1/business", { timezone: "Mars" })).rejects.toMatchObject({
            name: "ApiError",
            status: 422,
            code: "invalid_timezone",
        });
    });

    it("leave the code empty when the body names none", async () => {
        const state = setup();
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response("gateway", { status: 502 }))),
        );
        await expect(state.api.get("/v1/x")).rejects.toMatchObject({ status: 502, code: null });
    });
});
