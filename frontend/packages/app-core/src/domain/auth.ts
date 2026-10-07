import { useQuery } from "@powersync/react";
import { useEffect, useMemo, useState } from "react";

import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import { type ApiLike, failedStatus } from "../api";

type AuthMode = "signin" | "signup" | "reset" | "sent";

/** Matches api-client's TokenPair; kept local so app-core needn't depend on api-client for one type. */
export interface AuthTokens {
    access_token: string;
    refresh_token: string;
    token_type?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 30;

interface AuthFieldErrors {
    name?: string;
    email?: string;
    password?: string;
}

interface AuthForm {
    mode: AuthMode;
    setMode: (m: AuthMode) => void;
    name: string;
    setName: (v: string) => void;
    email: string;
    setEmail: (v: string) => void;
    password: string;
    setPassword: (v: string) => void;
    reveal: boolean;
    toggleReveal: () => void;
    fieldErrors: AuthFieldErrors;
    error: string | null;
    attemptsLeft: number | null;
    locked: boolean;
    busy: boolean;
    cooldown: number;
    submit: () => void;
    resend: () => void;
    googleUnavailable: () => void;
}

/** Sign in, create an account, and reset a password on one card. `setTokens` is injected per platform. */
export function useAuthForm(
    api: ApiLike,
    setTokens: (tokens: AuthTokens) => void | Promise<void>,
    onSuccess: () => void,
    opts?: { initialMode?: AuthMode; defaultEmail?: string; defaultPassword?: string },
): AuthForm {
    const a = strings.auth;
    const [mode, setModeState] = useState<AuthMode>(opts?.initialMode ?? "signin");
    const [name, setName] = useState("");
    const [email, setEmail] = useState(opts?.defaultEmail ?? "");
    const [password, setPassword] = useState(opts?.defaultPassword ?? "");
    const [reveal, setReveal] = useState(false);
    const [failed, setFailed] = useState(0);
    const [locked, setLocked] = useState(false);
    const [cooldown, setCooldown] = useState(0);
    const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
    const { busy, error, setError, run } = useAsyncAction();

    useEffect(() => {
        if (cooldown <= 0) return undefined;
        const t = setTimeout(() => {
            setCooldown((c) => c - 1);
        }, 1000);
        return () => {
            clearTimeout(t);
        };
    }, [cooldown]);

    const setMode = (m: AuthMode): void => {
        setModeState(m);
        setFieldErrors({});
        setError(null);
    };

    const sendReset = (): void => {
        run(
            async () => {
                await api.post("/auth/forgot-password", { email: email.trim() });
                setModeState("sent");
                setCooldown(RESEND_SECONDS);
            },
            { errorMessage: a.resetError },
        );
    };

    const submit = (): void => {
        const errs: AuthFieldErrors = {};
        const trimmed = email.trim();
        if (trimmed === "") errs.email = a.emailRequired;
        else if (!EMAIL.test(trimmed)) errs.email = a.emailInvalid;
        if (mode === "signup" && name.trim() === "") errs.name = a.nameRequired;
        if (mode === "signin" && password === "") errs.password = a.passwordRequired;
        if (mode === "signup" && password.length < 8) errs.password = a.passwordShort;
        setFieldErrors(errs);
        if (Object.keys(errs).length > 0) return;
        if (mode === "reset") {
            sendReset();
            return;
        }
        if (mode === "signup") {
            run(
                async () => {
                    const body = { email: trimmed, password, name: name.trim() };
                    await setTokens(await api.post<AuthTokens>("/auth/register", body));
                },
                { onSuccess, errorMessage: a.createAccountError },
            );
            return;
        }
        if (locked) return;
        const go = async (): Promise<void> => {
            setError(null);
            try {
                const tokens = await api.post<AuthTokens>("/auth/login", {
                    email: trimmed,
                    password,
                });
                await setTokens(tokens);
                setFailed(0);
                onSuccess();
            } catch (e) {
                const status = failedStatus(e);
                if (status === 429) {
                    setLocked(true);
                    setError(a.locked);
                } else if (status === 401) {
                    const next = failed + 1;
                    setFailed(next);
                    if (next >= MAX_ATTEMPTS) setLocked(true);
                    setError(next >= MAX_ATTEMPTS ? a.locked : a.invalidCredentials);
                } else {
                    setError(strings.common.somethingWrongRetry);
                }
            }
        };
        run(go);
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
        reveal,
        toggleReveal: () => {
            setReveal((r) => !r);
        },
        fieldErrors,
        error,
        attemptsLeft: failed > 0 && !locked ? MAX_ATTEMPTS - failed : null,
        locked,
        busy,
        cooldown,
        submit,
        resend: () => {
            if (cooldown <= 0) sendReset();
        },
        googleUnavailable: () => {
            setError(a.googleNotConfigured);
        },
    };
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Streaming base64url → byte string (DOM-free so it also type-checks under the mobile lib set).
function base64UrlDecode(input: string): string {
    let out = "";
    let buffer = 0;
    let bits = 0;
    for (const ch of input.replace(/-/g, "+").replace(/_/g, "/")) {
        const idx = B64.indexOf(ch);
        if (idx < 0) continue; // padding / stray chars
        buffer = (buffer << 6) | idx;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out += String.fromCharCode((buffer >> bits) & 0xff);
        }
    }
    return out;
}

/** Unverified: the value only scopes a local read; the server authorizes every write. */
function decodeJwtSub(token: string | null): string | null {
    if (token === null) return null;
    const payload = token.split(".")[1];
    if (payload === undefined) return null;
    try {
        const claims = JSON.parse(base64UrlDecode(payload)) as { sub?: unknown };
        return typeof claims.sub === "string" ? claims.sub : null;
    } catch {
        return null;
    }
}

export interface Viewer {
    staffId: string;
    role: string;
}

export const CURRENT_VIEWER_SQL =
    "SELECT id, role FROM staff WHERE user_id = ? AND status = 'active' LIMIT 1";

/** `null` until the member's staff row syncs, or when signed out. */
export function useCurrentViewer(accessToken: string | null): Viewer | null {
    const userId = useMemo(() => decodeJwtSub(accessToken), [accessToken]);
    const rows = useQuery<{ id: string; role: string }>(CURRENT_VIEWER_SQL, [userId]).data;
    const row = rows[0];
    return row === undefined ? null : { staffId: row.id, role: row.role };
}

export function useCurrentRole(accessToken: string | null): string | null {
    return useCurrentViewer(accessToken)?.role ?? null;
}
