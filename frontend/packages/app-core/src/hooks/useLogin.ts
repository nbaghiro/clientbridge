import { useState } from "react";

import { strings } from "../strings";
import type { ApiLike } from "../util/api";
import { useAsyncAction } from "./useAsyncAction";

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

/** Shared sign-in / sign-up form: state + the /auth call + error copy. `setTokens` is injected
 *  (web sync, mobile async); the platform owns only the inputs + layout. T = the token-pair shape. */
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
