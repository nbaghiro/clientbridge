// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Flow, FlowNode, FlowStep, IdentityLike } from "../api";
import { strings } from "../strings";
import {
    passwordSaveOutcome,
    reauthMethods,
    useAuthForm,
    useRecoveryForm,
    useSecuritySettings,
    useVerificationForm,
} from "./auth";

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
        exchange: vi.fn<IdentityLike["exchange"]>(() => Promise.resolve("exchanged-token")),
        signOut: vi.fn<IdentityLike["signOut"]>(() => Promise.resolve()),
    };
}

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

    it("steps up to a second factor in place when Kratos asks for aal2", async () => {
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
        expect(identity.start).toHaveBeenLastCalledWith("login", { aal: "aal2" });
        expect(result.current.mfaMethods).toContain("totp");
    });

    it("treats a session Kratos already holds as signed in", async () => {
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
});
