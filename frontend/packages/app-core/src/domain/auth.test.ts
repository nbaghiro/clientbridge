// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiLike, Flow, FlowNode, FlowStep, IdentityLike, WebAuthnLike } from "../api";
import { strings } from "../strings";
import {
    checkSession,
    passwordSaveOutcome,
    reauthMethods,
    useAuthForm,
    useRecoveryForm,
    useSecuritySettings,
    useVerificationForm,
} from "./auth";

// unmount each hook, so a ticking timer cannot render after the file's DOM is torn down
afterEach(cleanup);

const node = (group: string, name: string, value: unknown = ""): FlowNode => ({
    group,
    name,
    kind: "input",
    value,
    messages: [],
});

const flow = (
    nodes: FlowNode[],
    state: string | null = null,
    kind: Flow["kind"] = "settings",
): Flow => ({
    kind,
    id: `${kind}-1`,
    state,
    nodes,
    messages: [],
});

function fakeIdentity(steps: FlowStep[]) {
    const queue = [...steps];
    return {
        start: vi.fn<IdentityLike["start"]>((kind) => Promise.resolve(flow([], null, kind))),
        resume: vi.fn<IdentityLike["resume"]>((kind) => Promise.resolve(flow([], null, kind))),
        submit: vi.fn<IdentityLike["submit"]>(() => {
            const next = queue.shift();
            return next ? Promise.resolve(next) : Promise.reject(new Error("no step queued"));
        }),
        session: vi.fn<IdentityLike["session"]>(() => Promise.resolve("none")),
        whoami: vi.fn<IdentityLike["whoami"]>(() =>
            Promise.resolve({ id: "id-1", email: "saved@test.ca" }),
        ),
        exchange: vi.fn<IdentityLike["exchange"]>(() => Promise.resolve("exchanged-token")),
        signOut: vi.fn<IdentityLike["signOut"]>(() => Promise.resolve()),
    };
}

describe("checkSession", () => {
    const unused = (): Promise<never> => Promise.reject(new Error("unused"));
    const apiOf = (get: ApiLike["get"]): ApiLike => ({
        get,
        getText: unused,
        post: unused,
        patch: unused,
        delete: unused,
    });
    const refusing = (status: number, code: string): ApiLike =>
        apiOf(() => Promise.reject(Object.assign(new Error(code), { status, code })));

    it("names the signed-in user", async () => {
        const api = apiOf((() => Promise.resolve({ user_id: "us_1" })) as ApiLike["get"]);
        expect(await checkSession(api, null)).toMatchObject({ state: "user", userId: "us_1" });
    });

    it("keeps a recently verified user through an outage, and nobody otherwise", async () => {
        const verifiedAt = Date.now();
        expect(
            await checkSession(refusing(503, "identity_unavailable"), "us_1", verifiedAt),
        ).toEqual({
            state: "user",
            userId: "us_1",
            verifiedAt,
        });
        expect(await checkSession(refusing(503, "identity_unavailable"), null)).toEqual({
            state: "none",
        });
        expect(await checkSession(refusing(401, "unauthenticated"), "us_1")).toEqual({
            state: "none",
        });
    });

    it("requires online verification after seven days, with no timestamp, or after a clock rollback", async () => {
        for (const time of [0, Date.now() - 7 * 86400_000, Date.now() + 86400_000])
            await expect(
                checkSession(refusing(503, "identity_unavailable"), "us_1", time),
            ).rejects.toMatchObject({ code: "offline_access_expired" });
    });

    it("holds a live session the API refuses until its email is verified", async () => {
        expect(await checkSession(refusing(409, "email_in_use"), "us_1")).toEqual({
            state: "unverified",
        });
    });

    it("surfaces any other refusal instead of a sign-in that would loop", async () => {
        await expect(checkSession(refusing(403, "origin_refused"), "us_1")).rejects.toMatchObject({
            code: "origin_refused",
        });
    });
});

describe("passwordSaveOutcome", () => {
    it("counts only a finished flow as saved", () => {
        expect(passwordSaveOutcome({ kind: "flow", flow: flow([], "success") })).toBe("saved");
        expect(passwordSaveOutcome({ kind: "done" })).toBe("saved");
    });

    it("shows a refused password again", () => {
        expect(passwordSaveOutcome({ kind: "flow", flow: flow([], "show_form") })).toBe("retry");
    });

    it("starts over when the recovery session lapsed, never signing in unchanged", () => {
        expect(passwordSaveOutcome({ kind: "reauth" })).toBe("restart");
        expect(passwordSaveOutcome({ kind: "restart" })).toBe("restart");
        expect(passwordSaveOutcome({ kind: "redirect", url: "https://auth/x" })).toBe("restart");
    });
});

describe("reauthMethods", () => {
    const password = node("password", "password");
    const google = node("oidc", "provider", "google");

    it("offers what the refresh flow contains", () => {
        expect(reauthMethods(flow([password]), true)).toEqual({ password: true, google: false });
        expect(reauthMethods(flow([google]), true)).toEqual({ password: false, google: true });
    });

    it("offers Google only where the app can open it", () => {
        expect(reauthMethods(flow([password, google]), false)).toEqual({
            password: true,
            google: false,
        });
    });
});

describe("useAuthForm", () => {
    it("signs in with a password and hands over the session token", async () => {
        const identity = fakeIdentity([{ kind: "done", sessionToken: "tok" }]);
        identity.session.mockResolvedValueOnce("none").mockResolvedValueOnce("active");
        const signedIn = vi.fn();
        const { result } = renderHook(() => useAuthForm(identity, signedIn));
        await waitFor(() => {
            expect(identity.session).toHaveBeenCalledTimes(1);
        });
        act(() => {
            result.current.setEmail("pat@test.ca");
            result.current.setPassword("hunter22");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(signedIn).toHaveBeenCalledWith("tok");
        });
        expect(identity.submit.mock.calls[0]?.[1]).toMatchObject({
            method: "password",
            identifier: "pat@test.ca",
        });
    });

    it("steps up to a second factor in place when the auth service asks for one", async () => {
        const identity = fakeIdentity([
            { kind: "redirect", url: "https://auth.test/self-service/login/browser?aal=aal2" },
        ]);
        identity.start.mockImplementation((kind) =>
            Promise.resolve(flow([node("totp", "totp_code")], null, kind)),
        );
        const { result } = renderHook(() => useAuthForm(identity, vi.fn()));
        act(() => {
            result.current.setEmail("pat@test.ca");
            result.current.setPassword("hunter22");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.mode).toBe("mfa");
        });
        expect(identity.start).toHaveBeenLastCalledWith("login", { secondFactor: true });
        expect(result.current.mfaMethods).toContain("totp");
    });

    describe("a security key at the second step", () => {
        const challenge = [
            { ...node("default", "identifier"), value: "pat@test.ca" },
            node("webauthn", "webauthn_login_trigger", "{}"),
        ];
        const webauthn = {
            register: vi.fn<WebAuthnLike["register"]>(),
            login: vi.fn<WebAuthnLike["login"]>(() => Promise.resolve("assertion")),
        };

        async function atKeyStep(steps: FlowStep[]) {
            const identity = fakeIdentity([
                { kind: "redirect", url: "https://auth.test/self-service/login/browser?aal=aal2" },
                ...steps,
            ]);
            identity.start.mockImplementation((kind) =>
                Promise.resolve(flow(challenge, null, kind)),
            );
            const signedIn = vi.fn();
            const { result } = renderHook(() => useAuthForm(identity, signedIn, { webauthn }));
            act(() => {
                result.current.setEmail("pat@test.ca");
                result.current.setPassword("hunter22");
            });
            act(() => {
                result.current.submit();
            });
            await waitFor(() => {
                expect(result.current.mfaMethod).toBe("webauthn");
            });
            act(() => {
                result.current.submit();
            });
            return { identity, signedIn, result };
        }

        it("names the account it is proving, as the auth service requires", async () => {
            const { identity, signedIn } = await atKeyStep([{ kind: "done" }]);
            await waitFor(() => {
                expect(signedIn).toHaveBeenCalled();
            });
            expect(identity.submit).toHaveBeenLastCalledWith(
                expect.anything(),
                {
                    method: "webauthn",
                    identifier: "pat@test.ca",
                    webauthn_login: "assertion",
                },
                undefined,
            );
        });

        it("shows a refusal the auth service pins to a field this step does not show", async () => {
            const refused = node("default", "identifier");
            refused.messages = [{ id: 4000002, type: "error", text: "missing" }];
            const { result } = await atKeyStep([
                { kind: "flow", flow: flow([refused], null, "login") },
            ]);
            await waitFor(() => {
                expect(result.current.error).toBe(strings.auth.mfaKeyRefused);
            });
        });

        it("says the key didn't work when its prompt fails, and forgets that on another method", async () => {
            webauthn.login.mockRejectedValueOnce(new Error("NotAllowedError"));
            const { identity, result } = await atKeyStep([]);
            await waitFor(() => {
                expect(result.current.error).toBe(strings.auth.mfaKeyRefused);
            });
            expect(identity.submit).toHaveBeenCalledTimes(1);
            act(() => {
                result.current.setMfaMethod("lookup_secret");
            });
            expect(result.current.error).toBeNull();
        });
    });

    it("treats a session the auth service already holds as signed in", async () => {
        const identity = fakeIdentity([]);
        identity.session.mockResolvedValueOnce("none").mockResolvedValueOnce("active");
        identity.start.mockRejectedValue(
            Object.assign(new Error("refused"), { code: "session_already_available" }),
        );
        const signedIn = vi.fn();
        const { result } = renderHook(() => useAuthForm(identity, signedIn));
        await waitFor(() => {
            expect(identity.session).toHaveBeenCalledTimes(1);
        });
        act(() => {
            result.current.setEmail("pat@test.ca");
            result.current.setPassword("hunter22");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(signedIn).toHaveBeenCalled();
        });
        expect(result.current.error).toBeNull();
    });
});

describe("useRecoveryForm", () => {
    const sent = flow([], "sent_email", "recovery");

    async function toPasswordStep(steps: FlowStep[]) {
        const identity = fakeIdentity([
            { kind: "flow", flow: sent },
            { kind: "done", sessionToken: "recovered", next: { flow: "settings", id: "s-1" } },
            ...steps,
        ]);
        const signedIn = vi.fn();
        const { result } = renderHook(() => useRecoveryForm(identity, signedIn));
        act(() => {
            result.current.setEmail("pat@test.ca");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.step).toBe("code");
        });
        act(() => {
            result.current.setCode("123456");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.step).toBe("password");
        });
        act(() => {
            result.current.setPassword("a-new-password");
        });
        act(() => {
            result.current.submit();
        });
        return { identity, signedIn, result };
    }

    it("signs in only once the new password is saved", async () => {
        const { identity, signedIn } = await toPasswordStep([
            { kind: "flow", flow: flow([], "success") },
        ]);
        await waitFor(() => {
            expect(signedIn).toHaveBeenCalledWith("recovered");
        });
        expect(identity.submit).toHaveBeenLastCalledWith(
            expect.anything(),
            { method: "password", password: "a-new-password" },
            "recovered",
        );
    });

    it("starts over when the privileged window ran out, without signing in", async () => {
        const { signedIn, result } = await toPasswordStep([{ kind: "reauth" }]);
        await waitFor(() => {
            expect(result.current.step).toBe("email");
        });
        expect(result.current.error).toBe(strings.auth.flowExpired);
        expect(signedIn).not.toHaveBeenCalled();
    });
});

describe("useVerificationForm", () => {
    it("submits the code an emailed link filled in", async () => {
        const identity = fakeIdentity([
            { kind: "flow", flow: flow([], "passed_challenge", "verification") },
        ]);
        identity.resume.mockResolvedValue(
            flow([node("code", "code", "654321")], "sent_email", "verification"),
        );
        const { result } = renderHook(() => useVerificationForm(identity, { flowId: "v-1" }));
        await waitFor(() => {
            expect(result.current.verified).toBe(true);
        });
        expect(identity.submit.mock.calls[0]?.[1]).toEqual({ method: "code", code: "654321" });
    });

    it("sends the code to the identity's own email when signed in without a flow", async () => {
        const identity = fakeIdentity([
            { kind: "flow", flow: flow([], "sent_email", "verification") },
        ]);
        const { result } = renderHook(() => useVerificationForm(identity, {}));
        await waitFor(() => {
            expect(result.current.cooldown).toBeGreaterThan(0);
        });
        expect(identity.submit.mock.calls[0]?.[1]).toEqual({
            method: "code",
            email: "saved@test.ca",
        });
    });

    it("sends one code and holds resends during the cooldown", async () => {
        const identity = fakeIdentity([
            { kind: "flow", flow: flow([], "sent_email", "verification") },
        ]);
        const { result } = renderHook(() =>
            useVerificationForm(identity, { email: "pat@test.ca" }),
        );
        await waitFor(() => {
            expect(result.current.cooldown).toBeGreaterThan(0);
        });
        act(() => {
            result.current.resend();
        });
        expect(identity.submit).toHaveBeenCalledTimes(1);
    });
});

describe("useSecuritySettings", () => {
    const settings = flow(
        [node("profile", "traits.email", "saved@test.ca"), node("profile", "traits.name", "Pat")],
        "show_form",
    );

    function render(
        steps: FlowStep[],
        refresh: Flow,
        opts: Parameters<typeof useSecuritySettings>[1] = {},
    ) {
        const identity = fakeIdentity(steps);
        identity.start.mockImplementation((kind) =>
            Promise.resolve(kind === "settings" ? settings : refresh),
        );
        const hook = renderHook(() => useSecuritySettings(identity, opts));
        return { identity, ...hook };
    }

    it("asks for a key's name before prompting for the key", async () => {
        const register = vi.fn<WebAuthnLike["register"]>(() => Promise.resolve("credential"));
        const identity = fakeIdentity([]);
        identity.start.mockImplementation((kind) =>
            Promise.resolve(
                flow([node("webauthn", "webauthn_register_trigger", "{}")], null, kind),
            ),
        );
        const { result } = renderHook(() =>
            useSecuritySettings(identity, {
                webauthn: { register, login: vi.fn<WebAuthnLike["login"]>() },
            }),
        );
        await waitFor(() => {
            expect(result.current.ready).toBe(true);
        });
        act(() => {
            result.current.setKeyName("   ");
        });
        act(() => {
            result.current.addKey();
        });
        expect(result.current.keyNameError).toBe(strings.auth.securityKeyNameRequired);
        expect(register).not.toHaveBeenCalled();
    });

    it("starts one settings flow when React runs its effects twice, so the secret stays put", async () => {
        const identity = fakeIdentity([]);
        let minted = 0;
        identity.start.mockImplementation((kind) => {
            minted += 1;
            const secret = node("totp", "totp_secret_key");
            secret.text = `SECRET${String(minted)}`;
            return Promise.resolve(flow([secret], "show_form", kind));
        });
        const { result } = renderHook(() => useSecuritySettings(identity), { wrapper: StrictMode });
        await waitFor(() => {
            expect(result.current.totp.secret).not.toBeNull();
        });
        expect(identity.start).toHaveBeenCalledTimes(1);
        expect(result.current.totp.secret).toBe("SECRET1");
    });

    async function askForReauth(result: { current: ReturnType<typeof useSecuritySettings> }) {
        await waitFor(() => {
            expect(result.current.ready).toBe(true);
        });
        act(() => {
            result.current.setEmail("unsaved@test.ca");
            result.current.setNewPassword("a-new-password");
        });
        act(() => {
            result.current.savePassword();
        });
        await waitFor(() => {
            expect(result.current.reauth).not.toBeNull();
        });
    }

    it("reads the account back after a saved profile so the new name is stored at once", async () => {
        const get = vi.fn(() => Promise.resolve({}));
        const api = { get } as unknown as ApiLike;
        const { result } = render([{ kind: "flow", flow: flow([], "success") }], settings, { api });
        await waitFor(() => {
            expect(result.current.ready).toBe(true);
        });
        act(() => {
            result.current.setName("Pat Lee");
        });
        act(() => {
            result.current.saveProfile();
        });
        await waitFor(() => {
            expect(get).toHaveBeenCalledWith("/v1/me");
        });
    });

    it("confirms it's you with the saved email, not the edited one", async () => {
        const { identity, result } = render(
            [{ kind: "reauth" }, { kind: "done" }, { kind: "flow", flow: flow([], "success") }],
            flow([node("password", "password")], null, "login"),
        );
        await askForReauth(result);
        expect(result.current.reauth).toEqual({ password: true, google: false });
        act(() => {
            result.current.setReauthPassword("old-password");
        });
        act(() => {
            result.current.confirmReauth();
        });
        await waitFor(() => {
            expect(identity.submit).toHaveBeenCalledTimes(3);
        });
        expect(identity.submit.mock.calls[1]?.[1]).toMatchObject({
            method: "password",
            identifier: "saved@test.ca",
        });
    });

    it("re-authenticates with Google on mobile and keeps the new session token", async () => {
        const kept = vi.fn(() => Promise.resolve());
        const { identity, result } = render(
            [
                { kind: "reauth" },
                { kind: "redirect", url: "https://accounts.google.test/auth" },
                { kind: "flow", flow: flow([], "success") },
            ],
            flow([node("oidc", "provider", "google")], null, "login"),
            {
                openUrl: () => Promise.resolve("clientbridge://auth/callback?code=returned"),
                onSessionToken: kept,
            },
        );
        await askForReauth(result);
        expect(result.current.reauth).toEqual({ password: false, google: true });
        act(() => {
            result.current.reauthWithGoogle();
        });
        await waitFor(() => {
            expect(kept).toHaveBeenCalledWith("exchanged-token");
        });
        expect(identity.exchange).toHaveBeenCalledWith(expect.anything(), "returned");
        await waitFor(() => {
            expect(identity.submit).toHaveBeenCalledTimes(3);
        });
        expect(result.current.reauth).toBeNull();
    });

    it("discards a Google session that belongs to another account", async () => {
        const kept = vi.fn(() => Promise.resolve());
        const { identity, result } = render(
            [{ kind: "reauth" }, { kind: "redirect", url: "https://accounts.google.test/auth" }],
            flow([node("oidc", "provider", "google")], null, "login"),
            {
                openUrl: () => Promise.resolve("clientbridge://auth/callback?code=returned"),
                onSessionToken: kept,
            },
        );
        await askForReauth(result);
        identity.whoami.mockImplementation((sessionToken) =>
            Promise.resolve(
                sessionToken === "exchanged-token"
                    ? { id: "id-2", email: "other@test.ca" }
                    : { id: "id-1", email: "saved@test.ca" },
            ),
        );
        act(() => {
            result.current.reauthWithGoogle();
        });
        await waitFor(() => {
            expect(result.current.error).toBe(strings.auth.reauthDifferentAccount);
        });
        expect(kept).not.toHaveBeenCalled();
        expect(identity.signOut).toHaveBeenCalledWith("exchanged-token");
        expect(result.current.reauth).not.toBeNull();
        expect(identity.submit).toHaveBeenCalledTimes(2);
    });
});
