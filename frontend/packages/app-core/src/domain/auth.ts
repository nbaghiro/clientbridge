import { useQuery } from "@powersync/react";
import { useMemo, useState } from "react";

import { useAsyncAction } from "../hooks";
import { strings } from "../strings";
import type { ApiLike } from "../api";

export type LoginMode = "signin" | "signup";

/** Matches api-client's TokenPair; kept local so app-core needn't depend on api-client for one type. */
export interface AuthTokens {
    access_token: string;
    refresh_token: string;
    token_type?: string;
}

export interface LoginForm {
    mode: LoginMode;
    name: string;
    setName: (v: string) => void;
    email: string;
    setEmail: (v: string) => void;
    password: string;
    setPassword: (v: string) => void;
    busy: boolean;
    error: string | null;
    submit: () => void;
    flip: () => void;
    googleUnavailable: () => void;
}

/** `setTokens` is injected because web stores tokens synchronously and mobile asynchronously. */
export function useLogin(
    api: ApiLike,
    setTokens: (tokens: AuthTokens) => void | Promise<void>,
    onSuccess: () => void,
    opts?: { defaultEmail?: string; defaultPassword?: string },
): LoginForm {
    const [mode, setMode] = useState<LoginMode>("signin");
    const [name, setName] = useState("");
    const [email, setEmail] = useState(opts?.defaultEmail ?? "");
    const [password, setPassword] = useState(opts?.defaultPassword ?? "");
    const { busy, error, setError, run } = useAsyncAction();

    const submit = (): void => {
        run(
            async () => {
                const path = mode === "signin" ? "/auth/login" : "/auth/register";
                const body = mode === "signin" ? { email, password } : { email, password, name };
                await setTokens(await api.post<AuthTokens>(path, body));
            },
            {
                onSuccess,
                errorMessage:
                    mode === "signin"
                        ? strings.auth.invalidCredentials
                        : strings.auth.createAccountError,
            },
        );
    };

    const flip = (): void => {
        setMode(mode === "signin" ? "signup" : "signin");
        setError(null);
    };

    const googleUnavailable = (): void => {
        setError(strings.auth.googleNotConfigured);
    };

    return {
        mode,
        name,
        setName,
        email,
        setEmail,
        password,
        setPassword,
        busy,
        error,
        submit,
        flip,
        googleUnavailable,
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
export function decodeJwtSub(token: string | null): string | null {
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
