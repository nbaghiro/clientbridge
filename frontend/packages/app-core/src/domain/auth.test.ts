// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, StrictMode, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiLike, Flow, FlowNode, FlowStep, IdentityLike, WebAuthnLike } from "../api";
import { BusinessZoneContext } from "../datetime";
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
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

// the cooldown counts down one render at a time
function endCooldown(): void {
    for (let second = 0; second <= 30; second++)
        act(() => {
            vi.advanceTimersByTime(1000);
        });
}

const refused = (status: number, code: string): Error =>
    Object.assign(new Error(code), { status, code });

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
            Promise.resolve({ id: "id-1", email: "saved@test.ca", verified: false }),
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

    describe("a session this browser still holds", () => {
        const leftover = refused(400, "session_already_available");

        async function typeAndSubmit(steps: FlowStep[]) {
            const identity = fakeIdentity(steps);
            identity.session.mockResolvedValueOnce("none").mockResolvedValue("active");
            identity.start.mockRejectedValueOnce(leftover);
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
            return { identity, signedIn, result };
        }

        it("ends it and signs in as whoever's credentials were typed", async () => {
            const { identity, signedIn } = await typeAndSubmit([{ kind: "done" }]);
            await waitFor(() => {
                expect(signedIn).toHaveBeenCalled();
            });
            expect(identity.signOut).toHaveBeenCalledTimes(1);
            expect(identity.submit.mock.calls[0]?.[1]).toMatchObject({
                method: "password",
                identifier: "pat@test.ca",
                password: "hunter22",
            });
        });

        it("never lets a wrong password in on it", async () => {
            const wrong = {
                ...flow([], null, "login"),
                messages: [{ id: 4000006, type: "error", text: "invalid" }],
            };
            const { identity, signedIn, result } = await typeAndSubmit([
                { kind: "flow", flow: wrong },
            ]);
            await waitFor(() => {
                expect(result.current.error).toBe(strings.auth.flowMessages[4000006]);
            });
            expect(identity.signOut).toHaveBeenCalledTimes(1);
            expect(signedIn).not.toHaveBeenCalled();
        });

        it("shows a failure when it can't be ended, without signing in", async () => {
            const identity = fakeIdentity([]);
            identity.start.mockRejectedValue(leftover);
            const signedIn = vi.fn();
            const { result } = renderHook(() => useAuthForm(identity, signedIn, { probe: false }));
            act(() => {
                result.current.setEmail("pat@test.ca");
                result.current.setPassword("hunter22");
            });
            act(() => {
                result.current.submit();
            });
            await waitFor(() => {
                expect(result.current.error).toBe(strings.auth.unavailable);
            });
            expect(signedIn).not.toHaveBeenCalled();
        });

        it("starts a new flow when another tab signed in after this form's flow began", async () => {
            const wrong = {
                ...flow([], null, "login"),
                messages: [{ id: 4000006, type: "error", text: "invalid" }],
            };
            const identity = fakeIdentity([{ kind: "flow", flow: wrong }, { kind: "done" }]);
            const signedIn = vi.fn();
            const { result } = renderHook(() => useAuthForm(identity, signedIn, { probe: false }));
            act(() => {
                result.current.setEmail("pat@test.ca");
                result.current.setPassword("wrong-password");
            });
            act(() => {
                result.current.submit();
            });
            await waitFor(() => {
                expect(result.current.error).toBe(strings.auth.flowMessages[4000006]);
            });
            identity.submit.mockRejectedValueOnce(leftover);
            act(() => {
                result.current.setPassword("hunter22");
            });
            act(() => {
                result.current.submit();
            });
            await waitFor(() => {
                expect(signedIn).toHaveBeenCalled();
            });
            expect(identity.signOut).toHaveBeenCalledTimes(1);
            expect(identity.start).toHaveBeenCalledTimes(2);
        });

        it("ends it for Google too", async () => {
            const identity = fakeIdentity([{ kind: "redirect", url: "https://google.test" }]);
            identity.start.mockRejectedValueOnce(leftover);
            const openUrl = vi.fn(() => Promise.resolve(null));
            const { result } = renderHook(() =>
                useAuthForm(identity, vi.fn(), { probe: false, openUrl }),
            );
            act(() => {
                result.current.google();
            });
            await waitFor(() => {
                expect(openUrl).toHaveBeenCalledWith("https://google.test");
            });
            expect(identity.signOut).toHaveBeenCalledTimes(1);
        });
    });

    it("names a rate limit, which a phone can read", async () => {
        const identity = fakeIdentity([]);
        identity.submit.mockRejectedValueOnce(refused(429, "submit_failed"));
        const { result } = renderHook(() => useAuthForm(identity, vi.fn(), { probe: false }));
        act(() => {
            result.current.setEmail("pat@test.ca");
            result.current.setPassword("hunter22");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.error).toBe(strings.auth.tooManyAttempts);
        });
    });

    describe("the second step on a phone", () => {
        const login = flow([node("totp", "totp_code")], null, "login");

        async function atSecondStep(steps: FlowStep[] = []) {
            const identity = fakeIdentity([{ kind: "done", sessionToken: "half" }, ...steps]);
            identity.session.mockResolvedValue("second_factor");
            identity.start.mockImplementation(() => Promise.resolve(login));
            const holdSession = vi.fn();
            const signedIn = vi.fn();
            const { result } = renderHook(() =>
                useAuthForm(identity, signedIn, { holdSession, probe: false }),
            );
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
            return { identity, holdSession, signedIn, result };
        }

        it("ends the half-finished session on the server when the user backs out", async () => {
            const { identity, holdSession, result } = await atSecondStep();
            expect(holdSession).toHaveBeenLastCalledWith("half");
            act(() => {
                result.current.cancel();
            });
            await waitFor(() => {
                expect(result.current.mode).toBe("signin");
            });
            expect(identity.signOut).toHaveBeenCalledWith("half");
            expect(holdSession).toHaveBeenLastCalledWith(null);
        });

        it("lets go of the held token once signed in, before the app stores it", async () => {
            const { holdSession, signedIn, result } = await atSecondStep([
                { kind: "done", sessionToken: "full" },
            ]);
            act(() => {
                result.current.setCode("123456");
            });
            act(() => {
                result.current.submit();
            });
            await waitFor(() => {
                expect(signedIn).toHaveBeenCalledWith("full");
            });
            expect(holdSession).toHaveBeenLastCalledWith(null);
            expect(holdSession.mock.invocationCallOrder.at(-1)).toBeLessThan(
                signedIn.mock.invocationCallOrder[0] ?? 0,
            );
        });
    });

    describe("confirming the email after sign-up", () => {
        const sent = flow([], "sent_email", "verification");

        async function atVerify(steps: FlowStep[], confirmedElsewhere = false) {
            vi.useFakeTimers({ shouldAdvanceTime: true });
            const identity = fakeIdentity([
                { kind: "done", sessionToken: "signup", next: { flow: "verification", id: "v-1" } },
                ...steps,
            ]);
            identity.resume.mockResolvedValue(sent);
            identity.whoami.mockResolvedValue({
                id: "id-1",
                email: "pat@test.ca",
                verified: confirmedElsewhere,
            });
            const holdSession = vi.fn();
            const signedIn = vi.fn();
            const { result } = renderHook(() =>
                useAuthForm(identity, signedIn, {
                    initialMode: "signup",
                    probe: false,
                    holdSession,
                }),
            );
            act(() => {
                result.current.setName("Pat");
                result.current.setEmail("pat@test.ca");
                result.current.setPassword("hunter22");
            });
            act(() => {
                result.current.submit();
            });
            await waitFor(() => {
                expect(result.current.mode).toBe("verify");
            });
            act(() => {
                result.current.setCode("000000");
            });
            act(() => {
                result.current.submit();
            });
            return { identity, holdSession, signedIn, result };
        }

        it("asks for a new code when wrong ones used up the flow, then accepts it", async () => {
            const { identity, signedIn, result } = await atVerify([
                { kind: "restart", tooOften: true },
                { kind: "flow", flow: sent },
                { kind: "flow", flow: flow([], "passed_challenge", "verification") },
            ]);
            await waitFor(() => {
                expect(result.current.error).toBe(strings.auth.codeTooOften);
            });

            const submitted = identity.submit.mock.calls.length;
            act(() => {
                result.current.setCode("123456");
            });
            act(() => {
                result.current.submit();
            });
            expect(identity.submit).toHaveBeenCalledTimes(submitted);
            expect(result.current.error).toBe(strings.auth.codeTooOften);

            endCooldown();
            act(() => {
                result.current.resend();
            });
            await waitFor(() => {
                expect(result.current.error).toBeNull();
            });
            expect(identity.start).toHaveBeenLastCalledWith("verification");
            expect(identity.submit).toHaveBeenLastCalledWith(flow([], null, "verification"), {
                method: "code",
                email: "pat@test.ca",
            });
            expect(result.current.code).toBe("");
            expect(result.current.cooldown).toBeGreaterThan(0);

            act(() => {
                result.current.setCode("123456");
            });
            act(() => {
                result.current.submit();
            });
            await waitFor(() => {
                expect(signedIn).toHaveBeenCalledWith("signup");
            });
        });

        it("says the code expired when the flow did", async () => {
            const { result } = await atVerify([{ kind: "restart" }]);
            await waitFor(() => {
                expect(result.current.error).toBe(strings.auth.codeExpired);
            });
        });

        it("says the code expired when a browser's flow comes back replaced", async () => {
            const replaced = {
                ...flow([], "choose_method", "verification"),
                messages: [{ id: 4070005, type: "error", text: "expired" }],
            };
            const { result } = await atVerify([{ kind: "flow", flow: replaced }]);
            await waitFor(() => {
                expect(result.current.error).toBe(strings.auth.flowMessages[4070005]);
            });
        });

        it("carries on when the emailed link already confirmed it", async () => {
            const { identity, signedIn, holdSession } = await atVerify(
                [{ kind: "restart", tooOften: true }],
                true,
            );
            await waitFor(() => {
                expect(signedIn).toHaveBeenCalledWith("signup");
            });
            expect(identity.whoami).toHaveBeenCalledWith("signup");
            expect(holdSession).toHaveBeenLastCalledWith(null);
        });

        it("starts a new flow when a resend finds the old one expired", async () => {
            const { identity, result } = await atVerify([
                { kind: "flow", flow: sent },
                { kind: "restart" },
                { kind: "flow", flow: sent },
            ]);
            await waitFor(() => {
                expect(identity.submit).toHaveBeenCalledTimes(2);
            });
            endCooldown();
            act(() => {
                result.current.resend();
            });
            await waitFor(() => {
                expect(identity.submit).toHaveBeenCalledTimes(4);
            });
            expect(identity.start).toHaveBeenLastCalledWith("verification");
        });
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

    it("says a new password can't match the current one", async () => {
        const password = node("password", "password");
        password.messages = [{ id: 4000039, type: "error", text: "must be different" }];
        const { result } = await toPasswordStep([
            { kind: "flow", flow: flow([password], "show_form") },
        ]);
        await waitFor(() => {
            expect(result.current.fieldErrors.password).toBe(strings.auth.flowMessages[4000039]);
        });
        expect(result.current.step).toBe("password");
    });

    it("doesn't blame the code when the new password can't be saved", async () => {
        const { result } = await toPasswordStep([]);
        await waitFor(() => {
            expect(result.current.error).toBe(strings.auth.savePasswordFailed);
        });
        expect(result.current.step).toBe("password");
    });

    it("doesn't mention a code when the first one can't be sent", async () => {
        const identity = fakeIdentity([]);
        identity.start.mockRejectedValueOnce(new TypeError("offline"));
        const { result } = renderHook(() => useRecoveryForm(identity, vi.fn()));
        act(() => {
            result.current.setEmail("pat@test.ca");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.error).toBe(strings.auth.resendFailed);
        });
        expect(result.current.step).toBe("email");
    });

    it("names a rate limit on the code step", async () => {
        const identity = fakeIdentity([{ kind: "flow", flow: sent }]);
        const { result } = renderHook(() => useRecoveryForm(identity, vi.fn()));
        act(() => {
            result.current.setEmail("pat@test.ca");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.step).toBe("code");
        });
        identity.submit.mockRejectedValueOnce(refused(429, "submit_failed"));
        act(() => {
            result.current.setCode("123456");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.error).toBe(strings.auth.tooManyAttempts);
        });
    });

    describe("when wrong codes used up the flow", () => {
        async function atUsedUpCode(steps: FlowStep[]) {
            vi.useFakeTimers({ shouldAdvanceTime: true });
            const identity = fakeIdentity([
                { kind: "flow", flow: sent },
                { kind: "restart", tooOften: true },
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
                result.current.setCode("000000");
            });
            act(() => {
                result.current.submit();
            });
            await waitFor(() => {
                expect(result.current.error).toBe(strings.auth.codeTooOften);
            });
            return { identity, signedIn, result };
        }

        it("keeps its message up, and sends nothing more, until a new code is asked for", async () => {
            const { identity, result } = await atUsedUpCode([]);
            const submitted = identity.submit.mock.calls.length;
            act(() => {
                result.current.setCode("123456");
            });
            act(() => {
                result.current.submit();
            });
            expect(identity.submit).toHaveBeenCalledTimes(submitted);
            expect(result.current.error).toBe(strings.auth.codeTooOften);
            expect(result.current.step).toBe("code");
        });

        it("sends a new code on a new flow, and that code works", async () => {
            const { identity, result } = await atUsedUpCode([
                { kind: "flow", flow: sent },
                { kind: "done", sessionToken: "recovered", next: { flow: "settings", id: "s-1" } },
            ]);
            endCooldown();
            act(() => {
                result.current.resend();
            });
            await waitFor(() => {
                expect(result.current.error).toBeNull();
            });
            expect(identity.start).toHaveBeenCalledTimes(2);
            expect(identity.start).toHaveBeenLastCalledWith("recovery");
            expect(result.current.code).toBe("");
            act(() => {
                result.current.setCode("123456");
            });
            act(() => {
                result.current.submit();
            });
            await waitFor(() => {
                expect(result.current.step).toBe("password");
            });
        });
    });

    it("says the code expired when the flow did", async () => {
        const identity = fakeIdentity([{ kind: "flow", flow: sent }, { kind: "restart" }]);
        const { result } = renderHook(() => useRecoveryForm(identity, vi.fn()));
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
            expect(result.current.error).toBe(strings.auth.codeExpired);
        });
    });

    it("says the code expired when a browser's flow comes back replaced", async () => {
        const replaced = {
            ...flow([], "choose_method", "recovery"),
            messages: [{ id: 4060005, type: "error", text: "expired" }],
        };
        const identity = fakeIdentity([
            { kind: "flow", flow: sent },
            { kind: "flow", flow: replaced },
        ]);
        const { result } = renderHook(() => useRecoveryForm(identity, vi.fn()));
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
            expect(result.current.error).toBe(strings.auth.flowMessages[4060005]);
        });
        expect(result.current.step).toBe("code");
    });

    it("holds the reset's session token on a phone until it is finished or abandoned", async () => {
        const holdSession = vi.fn();
        const identity = fakeIdentity([
            { kind: "flow", flow: sent },
            { kind: "done", sessionToken: "recovered", next: { flow: "settings", id: "s-1" } },
            { kind: "flow", flow: flow([], "success") },
        ]);
        const signedIn = vi.fn();
        const { result } = renderHook(() => useRecoveryForm(identity, signedIn, { holdSession }));
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
        expect(holdSession).toHaveBeenLastCalledWith("recovered");
        act(() => {
            result.current.setPassword("a-new-password");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(signedIn).toHaveBeenCalledWith("recovered");
        });
        expect(holdSession).toHaveBeenLastCalledWith(null);
    });

    it("starts over when the privileged window ran out, without signing in", async () => {
        const { identity, signedIn, result } = await toPasswordStep([{ kind: "reauth" }]);
        await waitFor(() => {
            expect(result.current.step).toBe("email");
        });
        expect(result.current.error).toBe(strings.auth.flowExpired);
        expect(identity.signOut).toHaveBeenCalledWith("recovered");
        expect(signedIn).not.toHaveBeenCalled();
    });

    describe("an account with a second factor", () => {
        const login = flow([node("lookup_secret", "lookup_secret")], null, "login");

        async function toSecondFactor(steps: FlowStep[]) {
            const identity = fakeIdentity([
                { kind: "flow", flow: sent },
                { kind: "done", sessionToken: "recovered", next: { flow: "settings", id: "s-1" } },
                ...steps,
            ]);
            identity.session.mockResolvedValue("second_factor");
            identity.start.mockImplementation((kind) =>
                Promise.resolve(kind === "login" ? login : flow([], null, kind)),
            );
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
                expect(result.current.step).toBe("mfa");
            });
            return { identity, signedIn, result };
        }

        it("treats the accepted code as right and offers the account's methods", async () => {
            const { identity, result } = await toSecondFactor([]);
            expect(result.current.error).toBeNull();
            expect(result.current.code).toBe("");
            expect(result.current.mfaMethods).toEqual(["lookup_secret"]);
            expect(result.current.mfaMethod).toBe("lookup_secret");
            expect(identity.session).toHaveBeenCalledWith("recovered");
            expect(identity.resume).not.toHaveBeenCalled();
            expect(identity.start).toHaveBeenLastCalledWith("login", {
                secondFactor: true,
                sessionToken: "recovered",
            });
        });

        it("reaches the password step on the session the second factor hands back", async () => {
            const { identity, signedIn, result } = await toSecondFactor([
                { kind: "done", sessionToken: "upgraded" },
                { kind: "flow", flow: flow([], "success") },
            ]);
            act(() => {
                result.current.setCode("backup-1");
            });
            act(() => {
                result.current.submit();
            });
            await waitFor(() => {
                expect(result.current.step).toBe("password");
            });
            expect(identity.submit).toHaveBeenLastCalledWith(
                login,
                { method: "lookup_secret", lookup_secret: "backup-1" },
                "recovered",
            );
            expect(identity.resume).toHaveBeenLastCalledWith("settings", "s-1", "upgraded");
            expect(signedIn).not.toHaveBeenCalled();
            act(() => {
                result.current.setPassword("a-new-password");
            });
            act(() => {
                result.current.submit();
            });
            await waitFor(() => {
                expect(signedIn).toHaveBeenCalledWith("upgraded");
            });
        });

        it("stays on the second factor when its code is refused", async () => {
            const wrong = {
                ...login,
                messages: [{ id: 4000016, type: "error", text: "invalid" }],
            };
            const { result } = await toSecondFactor([{ kind: "flow", flow: wrong }]);
            act(() => {
                result.current.setCode("nope");
            });
            act(() => {
                result.current.submit();
            });
            await waitFor(() => {
                expect(result.current.error).toBe(strings.auth.flowMessages[4000016]);
            });
            expect(result.current.step).toBe("mfa");
        });

        it("asks for a code before submitting one", async () => {
            const { identity, result } = await toSecondFactor([]);
            const submitted = identity.submit.mock.calls.length;
            act(() => {
                result.current.submit();
            });
            expect(result.current.fieldErrors.code).toBe(strings.auth.codeRequired);
            expect(identity.submit).toHaveBeenCalledTimes(submitted);
        });

        it("ends the half-finished session when the user backs out", async () => {
            const { identity, signedIn, result } = await toSecondFactor([]);
            act(() => {
                result.current.cancel();
            });
            await waitFor(() => {
                expect(result.current.step).toBe("email");
            });
            expect(identity.signOut).toHaveBeenCalledWith("recovered");
            expect(signedIn).not.toHaveBeenCalled();
        });

        it("starts over when the password step won't open after the factor is spent", async () => {
            const { identity, signedIn, result } = await toSecondFactor([
                { kind: "done", sessionToken: "upgraded" },
            ]);
            identity.resume.mockRejectedValueOnce(new Error("offline"));
            act(() => {
                result.current.setCode("backup-1");
            });
            act(() => {
                result.current.submit();
            });
            await waitFor(() => {
                expect(result.current.step).toBe("email");
            });
            expect(result.current.error).toBe(strings.auth.unavailable);
            expect(identity.signOut).toHaveBeenCalledWith("upgraded");
            expect(signedIn).not.toHaveBeenCalled();
        });

        it("still starts over when the sign-out fails", async () => {
            const { identity, result } = await toSecondFactor([]);
            identity.signOut.mockRejectedValueOnce(new Error("offline"));
            act(() => {
                result.current.cancel();
            });
            await waitFor(() => {
                expect(result.current.step).toBe("email");
            });
            expect(result.current.error).toBeNull();
        });

        it("starts over when the second-factor flow expired", async () => {
            const { identity, result } = await toSecondFactor([{ kind: "restart" }]);
            act(() => {
                result.current.setCode("backup-1");
            });
            act(() => {
                result.current.submit();
            });
            await waitFor(() => {
                expect(result.current.step).toBe("email");
            });
            expect(result.current.error).toBe(strings.auth.flowExpired);
            expect(identity.signOut).toHaveBeenCalledWith("recovered");
        });
    });

    it("starts over rather than blaming the code when a later step fails", async () => {
        const identity = fakeIdentity([
            { kind: "flow", flow: sent },
            { kind: "done", sessionToken: "recovered", next: { flow: "settings", id: "s-1" } },
        ]);
        identity.resume.mockRejectedValueOnce(new Error("offline"));
        const { result } = renderHook(() => useRecoveryForm(identity, vi.fn()));
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
            expect(result.current.step).toBe("email");
        });
        expect(result.current.error).toBe(strings.auth.unavailable);
        expect(identity.signOut).toHaveBeenCalledWith("recovered");
    });

    it("ends a half-finished reset's session when a new reset is refused", async () => {
        const identity = fakeIdentity([{ kind: "flow", flow: sent }]);
        identity.start.mockRejectedValueOnce(
            Object.assign(new Error("session"), { code: "session_already_available" }),
        );
        const { result } = renderHook(() => useRecoveryForm(identity, vi.fn()));
        act(() => {
            result.current.setEmail("pat@test.ca");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.step).toBe("code");
        });
        expect(identity.signOut).toHaveBeenCalledTimes(1);
        expect(identity.start).toHaveBeenCalledTimes(2);
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

    it("asks for a new code when wrong ones used up the flow", async () => {
        const identity = fakeIdentity([
            { kind: "flow", flow: flow([], "sent_email", "verification") },
            { kind: "restart", tooOften: true },
        ]);
        const { result } = renderHook(() =>
            useVerificationForm(identity, { email: "pat@test.ca" }),
        );
        await waitFor(() => {
            expect(result.current.cooldown).toBeGreaterThan(0);
        });
        act(() => {
            result.current.setCode("000000");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.error).toBe(strings.auth.codeTooOften);
        });
        expect(result.current.verified).toBe(false);

        const submitted = identity.submit.mock.calls.length;
        act(() => {
            result.current.setCode("123456");
        });
        act(() => {
            result.current.submit();
        });
        expect(identity.submit).toHaveBeenCalledTimes(submitted);
        expect(result.current.error).toBe(strings.auth.codeTooOften);
    });

    it("sends a new code to the linked flow's address once wrong ones used it up", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const sent = flow([node("code", "email", "pat@test.ca")], "sent_email", "verification");
        const identity = fakeIdentity([
            { kind: "restart", tooOften: true },
            { kind: "flow", flow: sent },
        ]);
        identity.resume.mockResolvedValue(sent);
        const { result } = renderHook(() => useVerificationForm(identity, { flowId: "v-1" }));
        await waitFor(() => {
            expect(identity.resume).toHaveBeenCalled();
        });
        await act(async () => {
            await Promise.resolve();
        });
        act(() => {
            result.current.setCode("000000");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.error).toBe(strings.auth.codeTooOften);
        });
        act(() => {
            result.current.resend();
        });
        await waitFor(() => {
            expect(result.current.error).toBeNull();
        });
        expect(identity.submit).toHaveBeenLastCalledWith(flow([], null, "verification"), {
            method: "code",
            email: "pat@test.ca",
        });
    });

    it("shows the email as confirmed when its link got there first", async () => {
        const identity = fakeIdentity([
            { kind: "flow", flow: flow([], "sent_email", "verification") },
            { kind: "restart", tooOften: true },
        ]);
        identity.whoami.mockResolvedValue({ id: "id-1", email: "pat@test.ca", verified: true });
        const { result } = renderHook(() =>
            useVerificationForm(identity, { email: "pat@test.ca" }),
        );
        await waitFor(() => {
            expect(result.current.cooldown).toBeGreaterThan(0);
        });
        act(() => {
            result.current.setCode("123456");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.verified).toBe(true);
        });
        expect(result.current.error).toBeNull();
    });

    it("doesn't call this address confirmed because another verified account is signed in", async () => {
        const identity = fakeIdentity([
            { kind: "flow", flow: flow([], "sent_email", "verification") },
            { kind: "restart" },
        ]);
        identity.whoami.mockResolvedValue({ id: "id-2", email: "other@test.ca", verified: true });
        const { result } = renderHook(() =>
            useVerificationForm(identity, { email: "pat@test.ca" }),
        );
        await waitFor(() => {
            expect(result.current.cooldown).toBeGreaterThan(0);
        });
        act(() => {
            result.current.setCode("123456");
        });
        act(() => {
            result.current.submit();
        });
        await waitFor(() => {
            expect(result.current.error).toBe(strings.auth.codeExpired);
        });
        expect(result.current.verified).toBe(false);
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
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(BusinessZoneContext.Provider, { value: "America/Vancouver" }, children);

    function render(
        steps: FlowStep[],
        refresh: Flow,
        opts: Parameters<typeof useSecuritySettings>[1] = {},
    ) {
        const identity = fakeIdentity(steps);
        identity.start.mockImplementation((kind) =>
            Promise.resolve(kind === "settings" ? settings : refresh),
        );
        const hook = renderHook(() => useSecuritySettings(identity, opts), { wrapper });
        return { identity, ...hook };
    }

    it("words a used backup code itself, on the business's day", async () => {
        const codes = node("lookup_secret", "lookup_secret_codes");
        codes.context = {
            secrets: [
                {
                    id: 1050014,
                    text: "Secret was used at 2026-10-31 02:34:15 +0000 UTC",
                    context: { used_at: "2026-10-31T02:34:15Z" },
                },
                {
                    id: 1050014,
                    text: "Secret was used at 2026-10-31 03:00:00 +0000 UTC",
                    context: { used_at: "2026-10-31T03:00:00Z" },
                },
                { id: 1050009, text: "abcd1234", context: { secret: "abcd1234" } },
            ],
        };
        const identity = fakeIdentity([]);
        identity.start.mockResolvedValue(flow([codes], "show_form"));
        const { result } = renderHook(() => useSecuritySettings(identity), { wrapper });
        await waitFor(() => {
            expect(result.current.ready).toBe(true);
        });
        const used = strings.auth.backupCodeUsed("Oct 30, 2026");
        expect(result.current.backupCodes.codes).toEqual([
            { key: "used-0", label: used, used: true },
            { key: "used-1", label: used, used: true },
            { key: "abcd1234", label: "abcd1234", used: false },
        ]);
    });

    it("asks for a key's name before prompting for the key, and clears the ask once one is typed", async () => {
        const register = vi.fn<WebAuthnLike["register"]>(() => Promise.resolve("credential"));
        const identity = fakeIdentity([]);
        identity.start.mockImplementation((kind) =>
            Promise.resolve(
                flow([node("webauthn", "webauthn_register_trigger", "{}")], null, kind),
            ),
        );
        const { result } = renderHook(
            () =>
                useSecuritySettings(identity, {
                    webauthn: { register, login: vi.fn<WebAuthnLike["login"]>() },
                }),
            { wrapper },
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
        act(() => {
            result.current.setKeyName("Work laptop");
        });
        expect(result.current.keyNameError).toBeNull();
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
        const { result } = renderHook(() => useSecuritySettings(identity), {
            wrapper: ({ children }: { children: ReactNode }) =>
                createElement(StrictMode, null, wrapper({ children })),
        });
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
                    ? { id: "id-2", email: "other@test.ca", verified: true }
                    : { id: "id-1", email: "saved@test.ca", verified: true },
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
