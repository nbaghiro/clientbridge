import { useBusinessQuery as useQuery } from "../hooks";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import {
    type ApiLike,
    failedCode,
    failedStatus,
    type Flow,
    type FlowMessage,
    type FlowNode,
    type FlowStep,
    type IdentityLike,
    type WebAuthnLike,
} from "../api";

type AuthMode = "signin" | "signup" | "mfa" | "verify";
type MfaMethod = "totp" | "lookup_secret" | "webauthn";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_SECONDS = 30;

/** Catalog text for an auth service message; its own English is never shown. */
function flowMessage(message: FlowMessage): string | null {
    const known = (strings.auth.flowMessages as Readonly<Record<string, string | undefined>>)[
        String(message.id)
    ];
    return known ?? (message.type === "error" ? strings.auth.providerError : null);
}

function flowErrors(flow: Flow): { form: string | null; fields: Record<string, string> } {
    const fields: Record<string, string> = {};
    for (const node of flow.nodes) {
        const error = node.messages.find((m) => m.type === "error");
        if (error) fields[node.name] = flowMessage(error) ?? strings.auth.providerError;
    }
    const form = flow.messages.find((m) => m.type === "error");
    return { form: form ? flowMessage(form) : null, fields };
}

// React Native's URL has no searchParams, so query values are read by hand.
function queryParam(url: string, name: string): string | null {
    const match = new RegExp(`[?&]${name}=([^&#]*)`).exec(url);
    return match?.[1] === undefined ? null : decodeURIComponent(match[1]);
}

function nodeValue(flow: Flow | null, name: string): string {
    const value = flow?.nodes.find((n) => n.name === name)?.value;
    return typeof value === "string" ? value : "";
}

function useCooldown(): [number, (s: number) => void] {
    const [cooldown, setCooldown] = useState(0);
    useEffect(() => {
        if (cooldown <= 0) return undefined;
        const t = setTimeout(() => {
            setCooldown((c) => c - 1);
        }, 1000);
        return () => {
            clearTimeout(t);
        };
    }, [cooldown]);
    return [cooldown, setCooldown];
}

type SessionCheck =
    | { state: "user"; userId: string; verifiedAt: number }
    | { state: "none" }
    /** A live session the API refuses until its email is verified (a recreated identity). */
    | { state: "unverified" };

/** What `/v1/me` says about the session this device holds; offline, the remembered user stands. */
export async function checkSession(
    api: ApiLike,
    remembered: string | null,
    verifiedAt = 0,
): Promise<SessionCheck> {
    try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                reject(new Error("session check timed out"));
            }, 8_000);
        });
        const me = await Promise.race([api.get<{ user_id: string }>("/v1/me"), deadline]).finally(
            () => {
                clearTimeout(timer);
            },
        );
        return { state: "user", userId: me.user_id, verifiedAt: Date.now() };
    } catch (e) {
        const status = failedStatus(e);
        if (status === null || status >= 500) {
            if (remembered === null) return { state: "none" };
            const age = Date.now() - verifiedAt;
            if (
                !Number.isFinite(age) ||
                verifiedAt <= 0 ||
                age < 0 ||
                age >= 7 * 24 * 60 * 60 * 1000
            )
                throw Object.assign(new Error("offline access expired"), {
                    code: "offline_access_expired",
                });
            return { state: "user", userId: remembered, verifiedAt };
        }
        if (status === 401) return { state: "none" };
        if (failedCode(e) === "email_in_use") return { state: "unverified" };
        // Any other refusal: the shell offers retry and sign-out rather than a sign-in that loops.
        throw e;
    }
}

interface AuthFieldErrors {
    name?: string | undefined;
    email?: string | undefined;
    password?: string | undefined;
    code?: string | undefined;
}

interface AuthOptions {
    initialMode?: "signin" | "signup" | "mfa";
    defaultEmail?: string;
    defaultPassword?: string;
    /** The auth service sent the browser back to the UI with a flow (an OIDC error or an account to link). */
    flowId?: string;
    /** Where Google sign-in lands on web. */
    returnTo?: string;
    /** Ask the auth service for an existing session first (a step-up, or back from Google). */
    probe?: boolean;
    /** Web navigates away; mobile opens an auth session and returns the callback URL. */
    openUrl?: (url: string) => Promise<string | null>;
    /** The auth service set a session before the app signed in (sign-up waiting on email verification). */
    onSessionStarted?: () => void;
    webauthn?: WebAuthnLike;
}

interface AuthForm {
    mode: AuthMode;
    setMode: (m: "signin" | "signup") => void;
    name: string;
    setName: (v: string) => void;
    email: string;
    setEmail: (v: string) => void;
    password: string;
    setPassword: (v: string) => void;
    code: string;
    setCode: (v: string) => void;
    reveal: boolean;
    toggleReveal: () => void;
    fieldErrors: AuthFieldErrors;
    error: string | null;
    notice: string | null;
    busy: boolean;
    mfaMethods: MfaMethod[];
    mfaMethod: MfaMethod;
    setMfaMethod: (m: MfaMethod) => void;
    cooldown: number;
    submit: () => void;
    google: () => void;
    resend: () => void;
    skipVerification: () => void;
    cancel: () => void;
}

/** Sign in, sign up (then verify), and the second factor, over the auth service; mobile gets a token. */
export function useAuthForm(
    identity: IdentityLike,
    onSignedIn: (sessionToken?: string) => void | Promise<void>,
    opts?: AuthOptions,
): AuthForm {
    const a = strings.auth;
    const [mode, setModeState] = useState<AuthMode>(opts?.initialMode ?? "signin");
    const [name, setName] = useState("");
    const [email, setEmail] = useState(opts?.defaultEmail ?? "");
    const [password, setPassword] = useState(opts?.defaultPassword ?? "");
    const [code, setCode] = useState("");
    const [reveal, setReveal] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
    const [notice, setNotice] = useState<string | null>(null);
    const [mfaMethod, setMfaMethod] = useState<MfaMethod>("totp");
    const [cooldown, setCooldown] = useCooldown();
    const [flow, setFlow] = useState<Flow | null>(null);
    const pending = useRef<string | undefined>(undefined);
    const { busy, error, setError, run } = useAsyncAction();

    const show = useCallback(
        (next: Flow): void => {
            setFlow(next);
            const errs = flowErrors(next);
            setFieldErrors({
                email: errs.fields.identifier ?? errs.fields["traits.email"],
                name: errs.fields["traits.name"],
                password: errs.fields.password,
                code: errs.fields.totp_code ?? errs.fields.lookup_secret ?? errs.fields.code,
            });
            setError(errs.form);
            const info = next.messages.find((m) => m.type !== "error");
            setNotice(info ? flowMessage(info) : null);
        },
        [setError],
    );

    const secondStep = useCallback(
        (next: Flow): void => {
            setMfaMethod(mfaMethodsOf(next, opts?.webauthn)[0] ?? "totp");
            setModeState("mfa");
            setCode("");
            show(next);
        },
        [opts?.webauthn, show],
    );

    const finish = useCallback(
        async (sessionToken?: string): Promise<void> => {
            const state = await identity.session(sessionToken);
            if (state === "second_factor") {
                pending.current = sessionToken;
                secondStep(await identity.start("login", { secondFactor: true, sessionToken }));
                return;
            }
            await onSignedIn(sessionToken);
        },
        [identity, onSignedIn, secondStep],
    );

    const handle = useCallback(
        async (step: FlowStep, restart: () => void): Promise<void> => {
            if (step.kind === "flow") show(step.flow);
            else if (step.kind === "restart" || step.kind === "reauth") {
                setFlow(null);
                setError(a.flowExpired);
                restart();
            } else if (step.kind === "redirect") {
                // A second factor is due: the auth service points at a second-factor login (its own or ours).
                const id = queryParam(step.url, "flow");
                if (queryParam(step.url, "aal") === "aal2")
                    secondStep(await identity.start("login", { secondFactor: true }));
                else if (id && /\/login(\?|$)/.test(step.url))
                    secondStep(await identity.resume("login", id));
                else await opts?.openUrl?.(step.url);
            } else if (step.next?.flow === "verification") {
                opts?.onSessionStarted?.();
                pending.current = step.sessionToken;
                setFlow(await identity.resume("verification", step.next.id));
                setModeState("verify");
                setCode("");
                setCooldown(RESEND_SECONDS);
            } else await finish(step.sessionToken);
        },
        [a.flowExpired, finish, identity, opts, secondStep, setCooldown, setError, show],
    );

    useEffect(() => {
        let live = true;
        const kind = opts?.initialMode === "signup" ? "registration" : "login";
        const begin = async (): Promise<void> => {
            if (opts?.flowId) {
                const resumed = await identity.resume(kind, opts.flowId).catch(() => null);
                if (!live || !resumed) return;
                const secondFactorOnly =
                    mfaMethodsOf(resumed, opts.webauthn).length > 0 &&
                    !resumed.nodes.some((n) => n.group === "password");
                if (secondFactorOnly) secondStep(resumed);
                else show(resumed);
                return;
            }
            if (opts?.probe === false) return;
            const state = await identity.session();
            if (!live) return;
            if (state === "active") await onSignedIn();
            else if (state === "second_factor") await finish();
        };
        begin().catch(() => undefined);
        return () => {
            live = false;
        };
        // Runs once per mount: the URL's flow and the existing session decide the first screen.
    }, []);

    const setMode = (m: "signin" | "signup"): void => {
        setModeState(m);
        setFlow(null);
        setFieldErrors({});
        setNotice(null);
        setError(null);
    };

    const credentials = async (): Promise<void> => {
        const signup = mode === "signup";
        let current: Flow;
        try {
            current =
                flow?.kind === (signup ? "registration" : "login")
                    ? flow
                    : await identity.start(signup ? "registration" : "login", {
                          returnTo: opts?.returnTo,
                      });
        } catch (e) {
            // A session cookie the app didn't know about (say, a reload mid-verification).
            if (failedCode(e) !== "session_already_available") throw e;
            await finish();
            return;
        }
        const body = signup
            ? {
                  method: "password",
                  traits: { email: email.trim(), name: name.trim() },
                  password,
              }
            : { method: "password", identifier: email.trim(), password };
        await handle(await identity.submit(current, body), () => undefined);
    };

    const secondFactor = async (): Promise<void> => {
        const current = flow ?? (await identity.start("login", { secondFactor: true }));
        let body: Record<string, unknown>;
        if (mfaMethod === "webauthn") {
            const options = nodeValue(current, "webauthn_login_trigger");
            if (!opts?.webauthn || !options) throw new Error("webauthn unavailable");
            body = { method: "webauthn", webauthn_login: await opts.webauthn.login(options) };
        } else if (mfaMethod === "lookup_secret")
            body = { method: "lookup_secret", lookup_secret: code.trim() };
        else body = { method: "totp", totp_code: code.trim() };
        const step = await identity.submit(current, body, pending.current);
        if (step.kind === "done") {
            await onSignedIn(step.sessionToken ?? pending.current);
            return;
        }
        await handle(step, () => undefined);
    };

    const verify = async (): Promise<void> => {
        if (!flow) return;
        const step = await identity.submit(flow, { method: "code", code: code.trim() });
        if (step.kind === "flow" && step.flow.state === "passed_challenge") {
            await onSignedIn(pending.current);
            return;
        }
        await handle(step, () => undefined);
    };

    const submit = (): void => {
        const errs: AuthFieldErrors = {};
        if (mode === "signin" || mode === "signup") {
            const trimmed = email.trim();
            if (trimmed === "") errs.email = a.emailRequired;
            else if (!EMAIL.test(trimmed)) errs.email = a.emailInvalid;
            if (mode === "signup" && name.trim() === "") errs.name = a.nameRequired;
            if (mode === "signin" && password === "") errs.password = a.passwordRequired;
            if (mode === "signup" && password.length < 8) errs.password = a.passwordShort;
        } else if (mfaMethod !== "webauthn" && code.trim() === "") errs.code = a.codeRequired;
        setFieldErrors(errs);
        if (Object.keys(errs).length > 0) return;
        const work = mode === "mfa" ? secondFactor : mode === "verify" ? verify : credentials;
        run(work, { errorMessage: a.unavailable });
    };

    const google = (): void => {
        run(
            async () => {
                const current = await identity.start("login", { returnTo: opts?.returnTo });
                const step = await identity.submit(current, { method: "oidc", provider: "google" });
                if (step.kind !== "redirect") {
                    await handle(step, () => undefined);
                    return;
                }
                const callback = await opts?.openUrl?.(step.url);
                const returned = callback ? queryParam(callback, "code") : null;
                if (returned) await finish(await identity.exchange(current, returned));
            },
            { errorMessage: a.googleFailed },
        );
    };

    const resend = (): void => {
        if (cooldown > 0 || !flow) return;
        run(
            async () => {
                const address = nodeValue(flow, "email") || email.trim();
                const step = await identity.submit(flow, { method: "code", email: address });
                if (step.kind === "flow") show(step.flow);
                setCooldown(RESEND_SECONDS);
            },
            { errorMessage: a.resendFailed },
        );
    };

    return {
        mode,
        setMode,
        name,
        setName,
        email,
        setEmail,
        password,
        setPassword,
        code,
        setCode,
        reveal,
        toggleReveal: () => {
            setReveal((r) => !r);
        },
        fieldErrors,
        error,
        notice,
        busy,
        mfaMethods: mfaMethodsOf(flow, opts?.webauthn),
        mfaMethod,
        setMfaMethod: (m) => {
            setMfaMethod(m);
            setCode("");
            setFieldErrors({});
        },
        cooldown,
        submit,
        google,
        resend,
        skipVerification: () => {
            run(() => Promise.resolve(onSignedIn(pending.current)));
        },
        cancel: () => {
            run(async () => {
                await identity.signOut();
                pending.current = undefined;
                setMode("signin");
            });
        },
    };
}

function mfaMethodsOf(flow: Flow | null, webauthn: WebAuthnLike | undefined): MfaMethod[] {
    const groups = new Set(flow?.nodes.map((n) => n.group));
    return (["totp", "webauthn", "lookup_secret"] as const).filter(
        (m) => groups.has(m) && (m !== "webauthn" || webauthn !== undefined),
    );
}

interface RecoveryForm {
    step: "email" | "code" | "password";
    email: string;
    setEmail: (v: string) => void;
    code: string;
    setCode: (v: string) => void;
    password: string;
    setPassword: (v: string) => void;
    fieldErrors: AuthFieldErrors;
    error: string | null;
    notice: string | null;
    busy: boolean;
    cooldown: number;
    submit: () => void;
    resend: () => void;
}

/** Email a code, enter it, then choose a new password; the user ends up signed in. */
export function useRecoveryForm(
    identity: IdentityLike,
    onSignedIn: (sessionToken?: string) => void | Promise<void>,
    opts?: { defaultEmail?: string; flowId?: string },
): RecoveryForm {
    const a = strings.auth;
    const [step, setStep] = useState<RecoveryForm["step"]>("email");
    const [email, setEmail] = useState(opts?.defaultEmail ?? "");
    const [code, setCode] = useState("");
    const [password, setPassword] = useState("");
    const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
    const [notice, setNotice] = useState<string | null>(null);
    const [cooldown, setCooldown] = useCooldown();
    const [flow, setFlow] = useState<Flow | null>(null);
    const token = useRef<string | undefined>(undefined);
    const { busy, error, setError, run } = useAsyncAction();

    const show = (next: Flow): void => {
        setFlow(next);
        const errs = flowErrors(next);
        setFieldErrors({
            email: errs.fields.email,
            code: errs.fields.code,
            password: errs.fields.password,
        });
        setError(errs.form);
        const info = next.messages.find((m) => m.type !== "error");
        setNotice(info ? flowMessage(info) : null);
    };

    useEffect(() => {
        if (!opts?.flowId) return;
        identity
            .resume("recovery", opts.flowId)
            .then((resumed) => {
                show(resumed);
                if (resumed.state === "sent_email") setStep("code");
            })
            .catch(() => undefined);
    }, []);

    const sendCode = async (): Promise<void> => {
        const current = flow ?? (await identity.start("recovery"));
        const result = await identity.submit(current, { method: "code", email: email.trim() });
        if (result.kind !== "flow") throw new Error("recovery did not continue");
        show(result.flow);
        if (result.flow.state === "sent_email") {
            setStep("code");
            setCooldown(RESEND_SECONDS);
        }
    };

    const checkCode = async (): Promise<void> => {
        if (!flow) return;
        const result = await identity.submit(flow, { method: "code", code: code.trim() });
        if (result.kind === "flow") {
            show(result.flow);
            return;
        }
        if (result.kind !== "done" || result.next?.flow !== "settings")
            throw new Error("recovery did not continue");
        token.current = result.sessionToken;
        setFlow(await identity.resume("settings", result.next.id, result.sessionToken));
        setNotice(null);
        setStep("password");
    };

    const savePassword = async (): Promise<void> => {
        if (!flow) return;
        const result = await identity.submit(flow, { method: "password", password }, token.current);
        const outcome = passwordSaveOutcome(result);
        if (outcome === "saved") {
            await onSignedIn(token.current);
            return;
        }
        if (outcome === "retry" && result.kind === "flow") {
            show(result.flow);
            return;
        }
        // The recovery session's privileged window ran out: the password is unchanged, start again.
        setFlow(null);
        setCode("");
        setPassword("");
        setStep("email");
        setError(a.flowExpired);
    };

    const submit = (): void => {
        const errs: AuthFieldErrors = {};
        if (step === "email" && !EMAIL.test(email.trim())) errs.email = a.emailInvalid;
        if (step === "code" && code.trim() === "") errs.code = a.codeRequired;
        if (step === "password" && password.length < 8) errs.password = a.passwordShort;
        setFieldErrors(errs);
        if (Object.keys(errs).length > 0) return;
        const work = step === "email" ? sendCode : step === "code" ? checkCode : savePassword;
        run(work, { errorMessage: a.resetError });
    };

    return {
        step,
        email,
        setEmail,
        code,
        setCode,
        password,
        setPassword,
        fieldErrors,
        error,
        notice,
        busy,
        cooldown,
        submit,
        resend: () => {
            if (cooldown > 0 || !flow) return;
            run(
                async () => {
                    const result = await identity.submit(flow, {
                        method: "code",
                        email: email.trim(),
                    });
                    if (result.kind === "flow") show(result.flow);
                    setCooldown(RESEND_SECONDS);
                },
                { errorMessage: a.resendFailed },
            );
        },
    };
}

interface VerificationForm {
    verified: boolean;
    code: string;
    setCode: (v: string) => void;
    error: string | null;
    notice: string | null;
    busy: boolean;
    cooldown: number;
    submit: () => void;
    resend: () => void;
}

/** Confirms the email with the code the auth service sent (or a fresh one), e.g. from the verify link. */
export function useVerificationForm(
    identity: IdentityLike,
    opts: { flowId?: string; email?: string },
): VerificationForm {
    const a = strings.auth;
    const [flow, setFlow] = useState<Flow | null>(null);
    const [code, setCode] = useState("");
    const [notice, setNotice] = useState<string | null>(null);
    const [cooldown, setCooldown] = useCooldown();
    const { busy, error, setError, run } = useAsyncAction();

    const show = useCallback(
        (next: Flow): void => {
            setFlow(next);
            setError(flowErrors(next).form ?? Object.values(flowErrors(next).fields)[0] ?? null);
            const info = next.messages.find((m) => m.type !== "error");
            setNotice(info ? flowMessage(info) : null);
        },
        [setError],
    );

    const sentTo = useRef("");
    const send = useCallback(
        async (current: Flow, address: string): Promise<void> => {
            sentTo.current = address;
            const step = await identity.submit(current, { method: "code", email: address });
            if (step.kind === "flow") show(step.flow);
            setCooldown(RESEND_SECONDS);
        },
        [identity, setCooldown, show],
    );

    const confirm = useCallback(
        async (current: Flow, value: string): Promise<void> => {
            const step = await identity.submit(current, { method: "code", code: value });
            if (step.kind === "flow") show(step.flow);
            else if (step.kind === "restart") setError(a.flowExpired);
        },
        [identity, show, setError],
    );

    useEffect(() => {
        // A replaced run (development runs effects twice) must not send a second code.
        let live = true;
        const begin = async (): Promise<void> => {
            if (opts.flowId) {
                const resumed = await identity.resume("verification", opts.flowId);
                if (!live) return;
                // The emailed link only fills the code in; the auth service waits for it to be submitted.
                const linked = nodeValue(resumed, "code");
                if (resumed.state === "sent_email" && linked) {
                    setCode(linked);
                    await confirm(resumed, linked);
                } else show(resumed);
                return;
            }
            // Signed in without a flow (onboarding, an invite): send a code to the identity's email.
            const email = opts.email ?? (await identity.whoami())?.email ?? "";
            const current = await identity.start("verification");
            if (!live) return;
            if (email) await send(current, email);
            else show(current);
        };
        begin().catch(() => {
            if (live) setError(a.unavailable);
        });
        return () => {
            live = false;
        };
    }, []);

    return {
        verified: flow?.state === "passed_challenge",
        code,
        setCode,
        error,
        notice,
        busy,
        cooldown,
        submit: () => {
            if (!flow) return;
            if (code.trim() === "") {
                setError(a.codeRequired);
                return;
            }
            run(() => confirm(flow, code.trim()), { errorMessage: a.unavailable });
        },
        resend: () => {
            const address = sentTo.current || nodeValue(flow, "email");
            if (cooldown > 0 || !address) return;
            run(
                async () => {
                    await send(await identity.start("verification"), address);
                },
                { errorMessage: a.resendFailed },
            );
        },
    };
}

/** Recovery's last step: only a finished flow saved the password; a lapsed session starts over. */
export function passwordSaveOutcome(step: FlowStep): "saved" | "retry" | "restart" {
    if (step.kind === "done" || (step.kind === "flow" && step.flow.state === "success"))
        return "saved";
    return step.kind === "flow" ? "retry" : "restart";
}

/** How this identity can confirm it's them: the methods the auth service put in the refresh flow. */
export function reauthMethods(
    flow: Flow,
    canOpenUrl: boolean,
): { password: boolean; google: boolean } {
    return {
        password: flow.nodes.some((n) => n.group === "password"),
        google: canOpenUrl && flow.nodes.some((n) => n.group === "oidc" && n.value === "google"),
    };
}

interface SecurityKey {
    id: string;
    name: string;
}

interface SecuritySettings {
    ready: boolean;
    error: string | null;
    notice: string | null;
    busy: boolean;
    email: string;
    setEmail: (v: string) => void;
    name: string;
    setName: (v: string) => void;
    saveProfile: () => void;
    newPassword: string;
    setNewPassword: (v: string) => void;
    savePassword: () => void;
    totp: { enabled: boolean; qr: string | null; secret: string | null };
    totpCode: string;
    setTotpCode: (v: string) => void;
    enableTotp: () => void;
    disableTotp: () => void;
    backupCodes: { enabled: boolean; codes: string[] | null; unconfirmed: boolean };
    showBackupCodes: () => void;
    newBackupCodes: () => void;
    confirmBackupCodes: () => void;
    disableBackupCodes: () => void;
    keys: SecurityKey[] | null;
    keyName: string;
    setKeyName: (v: string) => void;
    addKey: () => void;
    removeKey: (id: string) => void;
    /** The ways this identity can confirm it's them again, or null while none is asked for. */
    reauth: { password: boolean; google: boolean } | null;
    reauthPassword: string;
    setReauthPassword: (v: string) => void;
    confirmReauth: () => void;
    reauthWithGoogle: () => void;
}

const hasNode = (flow: Flow | null, name: string): boolean =>
    flow?.nodes.some((n) => n.name === name) ?? false;

function backupCodesOf(flow: Flow | null): string[] | null {
    const node = flow?.nodes.find((n: FlowNode) => n.name === "lookup_secret_codes");
    const secrets = node?.context?.secrets;
    if (!Array.isArray(secrets)) return null;
    return secrets.map((s: unknown) => {
        const entry = typeof s === "object" && s !== null ? (s as Record<string, unknown>) : {};
        const nested = entry.text;
        return typeof nested === "string" ? nested : "";
    });
}

/** Account and sign-in security over the auth service's settings flow; `sessionToken` is mobile's. */
export function useSecuritySettings(
    identity: IdentityLike,
    opts?: {
        webauthn?: WebAuthnLike;
        sessionToken?: () => Promise<string | undefined>;
        /** Where Google re-authentication lands, and how to open it. */
        returnTo?: string;
        openUrl?: (url: string) => Promise<string | null>;
        /** Mobile keeps the session token a Google re-authentication hands back. */
        onSessionToken?: (sessionToken: string) => Promise<void>;
    },
): SecuritySettings {
    const a = strings.auth;
    const [flow, setFlow] = useState<Flow | null>(null);
    const [email, setEmail] = useState("");
    const [name, setName] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [totpCode, setTotpCode] = useState("");
    const [keyName, setKeyName] = useState("");
    const [notice, setNotice] = useState<string | null>(null);
    const [reauthFlow, setReauthFlow] = useState<Flow | null>(null);
    const [reauthPassword, setReauthPassword] = useState("");
    const savedEmail = useRef("");
    const retry = useRef<(() => Promise<void>) | null>(null);
    const options = useRef(opts);
    options.current = opts;
    const { busy, error, setError, run } = useAsyncAction();

    const token = useCallback(async () => options.current?.sessionToken?.(), []);

    const show = useCallback(
        (next: Flow): void => {
            setFlow(next);
            setEmail(nodeValue(next, "traits.email"));
            setName(nodeValue(next, "traits.name"));
            const errs = flowErrors(next);
            setError(errs.form ?? Object.values(errs.fields)[0] ?? null);
            const info = next.messages.find((m) => m.type !== "error");
            setNotice(info ? flowMessage(info) : null);
        },
        [setError],
    );

    const load = useCallback(async (): Promise<void> => {
        const fresh = await identity.start("settings", { sessionToken: await token() });
        savedEmail.current = nodeValue(fresh, "traits.email");
        show(fresh);
    }, [identity, show, token]);

    // One settings flow per visit, even when React runs effects twice: a new flow mints a new secret.
    const started = useRef(false);
    useEffect(() => {
        if (started.current) return;
        started.current = true;
        load().catch(() => {
            setError(a.unavailable);
        });
    }, []);

    const apply = (body: () => Promise<Record<string, unknown>>, after?: () => void): void => {
        const attempt = async (): Promise<void> => {
            const current =
                flow ?? (await identity.start("settings", { sessionToken: await token() }));
            const step = await identity.submit(current, await body(), await token());
            if (step.kind === "reauth") {
                retry.current = attempt;
                setReauthFlow(
                    await identity.start("login", {
                        refresh: true,
                        sessionToken: await token(),
                        returnTo: options.current?.returnTo,
                    }),
                );
                return;
            }
            if (step.kind === "restart") {
                await load();
                setError(a.flowExpired);
                return;
            }
            if (step.kind !== "flow") {
                await load();
                return;
            }
            show(step.flow);
            if (step.flow.state === "success") after?.();
        };
        run(attempt, { errorMessage: a.unavailable });
    };

    const keys: SecurityKey[] | null = opts?.webauthn
        ? (flow?.nodes ?? [])
              .filter((n) => n.name === "webauthn_remove")
              .map((n) => ({
                  id: typeof n.value === "string" ? n.value : "",
                  name:
                      typeof n.context?.display_name === "string"
                          ? n.context.display_name
                          : a.securityKey,
              }))
        : null;

    return {
        ready: flow !== null,
        error,
        notice,
        busy,
        email,
        setEmail,
        name,
        setName,
        saveProfile: () => {
            apply(() =>
                Promise.resolve({
                    method: "profile",
                    traits: { email: email.trim(), name: name.trim() },
                }),
            );
        },
        newPassword,
        setNewPassword,
        savePassword: () => {
            if (newPassword.length < 8) {
                setError(a.passwordShort);
                return;
            }
            apply(
                () => Promise.resolve({ method: "password", password: newPassword }),
                () => {
                    setNewPassword("");
                },
            );
        },
        totp: {
            enabled: hasNode(flow, "totp_unlink"),
            qr: flow?.nodes.find((n) => n.name === "totp_qr")?.src ?? null,
            secret: flow?.nodes.find((n) => n.name === "totp_secret_key")?.text ?? null,
        },
        totpCode,
        setTotpCode,
        enableTotp: () => {
            if (totpCode.trim() === "") {
                setError(a.codeRequired);
                return;
            }
            apply(
                () => Promise.resolve({ method: "totp", totp_code: totpCode.trim() }),
                () => {
                    setTotpCode("");
                },
            );
        },
        disableTotp: () => {
            apply(() => Promise.resolve({ method: "totp", totp_unlink: true }));
        },
        backupCodes: {
            enabled:
                hasNode(flow, "lookup_secret_reveal") || hasNode(flow, "lookup_secret_disable"),
            codes: backupCodesOf(flow),
            unconfirmed: hasNode(flow, "lookup_secret_confirm"),
        },
        showBackupCodes: () => {
            apply(() => Promise.resolve({ method: "lookup_secret", lookup_secret_reveal: true }));
        },
        newBackupCodes: () => {
            apply(() =>
                Promise.resolve({ method: "lookup_secret", lookup_secret_regenerate: true }),
            );
        },
        confirmBackupCodes: () => {
            apply(() => Promise.resolve({ method: "lookup_secret", lookup_secret_confirm: true }));
        },
        disableBackupCodes: () => {
            apply(() => Promise.resolve({ method: "lookup_secret", lookup_secret_disable: true }));
        },
        keys,
        keyName,
        setKeyName,
        addKey: () => {
            const webauthn = opts?.webauthn;
            const options = nodeValue(flow, "webauthn_register_trigger");
            if (!webauthn || !options) return;
            apply(
                async () => ({
                    method: "webauthn",
                    webauthn_register: await webauthn.register(options),
                    webauthn_register_displayname: keyName.trim() || a.securityKey,
                }),
                () => {
                    setKeyName("");
                },
            );
        },
        removeKey: (id) => {
            apply(() => Promise.resolve({ method: "webauthn", webauthn_remove: id }));
        },
        reauth: reauthFlow ? reauthMethods(reauthFlow, !!options.current?.openUrl) : null,
        reauthPassword,
        setReauthPassword,
        confirmReauth: () => {
            run(
                async () => {
                    const login =
                        reauthFlow ??
                        (await identity.start("login", {
                            refresh: true,
                            sessionToken: await token(),
                        }));
                    const step = await identity.submit(
                        login,
                        {
                            method: "password",
                            identifier: savedEmail.current,
                            password: reauthPassword,
                        },
                        await token(),
                    );
                    if (step.kind === "flow") {
                        setReauthFlow(step.flow);
                        setError(flowErrors(step.flow).form ?? a.invalidCredentials);
                        return;
                    }
                    setReauthFlow(null);
                    setReauthPassword("");
                    await load();
                    await retry.current?.();
                    retry.current = null;
                },
                { errorMessage: a.invalidCredentials },
            );
        },
        reauthWithGoogle: () => {
            run(
                async () => {
                    if (!reauthFlow) return;
                    const step = await identity.submit(
                        reauthFlow,
                        { method: "oidc", provider: "google" },
                        await token(),
                    );
                    if (step.kind !== "redirect") return;
                    // The web leaves for Google and comes back; mobile gets a callback URL instead.
                    const callback = await options.current?.openUrl?.(step.url);
                    const returned = callback ? queryParam(callback, "code") : null;
                    if (!returned) return;
                    const refreshed = await identity.exchange(reauthFlow, returned);
                    const [before, after] = await Promise.all([
                        identity.whoami(await token()),
                        identity.whoami(refreshed),
                    ]);
                    if (before === null || before.id !== after?.id) {
                        // Another Google account signed in: that session is not this person's.
                        await identity.signOut(refreshed).catch(() => undefined);
                        setError(a.reauthDifferentAccount);
                        return;
                    }
                    await options.current?.onSessionToken?.(refreshed);
                    setReauthFlow(null);
                    await load();
                    await retry.current?.();
                    retry.current = null;
                },
                { errorMessage: a.googleFailed },
            );
        },
    };
}

export interface Viewer {
    staffId: string;
    role: string;
}

export const CURRENT_VIEWER_SQL =
    "SELECT id, role FROM staff WHERE user_id = ? AND status = 'active' LIMIT 1";

/** `null` until the member's staff row syncs, or when signed out. */
export function useCurrentViewer(userId: string | null): Viewer | null {
    const rows = useQuery<{ id: string; role: string }>(CURRENT_VIEWER_SQL, [userId]).data;
    const row = rows[0];
    return row === undefined ? null : { staffId: row.id, role: row.role };
}

export function useCurrentRole(userId: string | null): string | null {
    return useCurrentViewer(userId)?.role ?? null;
}

export function isManager(role: string | null): boolean {
    return role === "owner" || role === "admin";
}
