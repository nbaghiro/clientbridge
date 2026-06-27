export interface TokenPair {
    access_token: string;
    refresh_token: string;
    token_type?: string;
}

export interface SessionStore {
    get(): Promise<TokenPair | null>;
    set(tokens: TokenPair): Promise<void>;
    clear(): Promise<void>;
}

export interface SessionOptions {
    baseUrl: string;
    store: SessionStore;
    /** Called once the session is unrecoverable (refresh failed) — the app should show login. */
    onSignedOut: () => void;
}

export interface Session {
    get<T>(path: string): Promise<T>;
    post<T>(path: string, body: unknown): Promise<T>;
    patch<T>(path: string, body: unknown): Promise<T>;
    /** Authenticated fetch with the same refresh-on-401 behavior — used by the PowerSync connector. */
    authFetch: (path: string, init?: RequestInit) => Promise<Response>;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function createSession(opts: SessionOptions): Session {
    let pending: Promise<boolean> | null = null;

    const refresh = async (): Promise<boolean> => {
        const tokens = await opts.store.get();
        if (tokens === null) return false; // not logged in (e.g. a failed login) — nothing to refresh
        try {
            const res = await fetch(`${opts.baseUrl}/auth/refresh`, {
                method: "POST",
                headers: JSON_HEADERS,
                body: JSON.stringify({ refresh_token: tokens.refresh_token }),
            });
            if (!res.ok) throw new Error(String(res.status));
            await opts.store.set((await res.json()) as TokenPair);
            return true;
        } catch {
            await opts.store.clear();
            opts.onSignedOut();
            return false;
        }
    };

    // One in-flight refresh at a time; concurrent 401s await the same attempt.
    const recover = (): Promise<boolean> => {
        pending ??= refresh().finally(() => {
            pending = null;
        });
        return pending;
    };

    const authFetch = async (path: string, init: RequestInit = {}): Promise<Response> => {
        const send = async (): Promise<Response> => {
            const token = (await opts.store.get())?.access_token ?? "";
            const headers: Record<string, string> = {
                ...(init.headers as Record<string, string> | undefined),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            };
            return fetch(`${opts.baseUrl}${path}`, { ...init, headers });
        };
        let res = await send();
        if (res.status === 401 && (await recover())) res = await send();
        return res;
    };

    const json = async <T>(path: string, init?: RequestInit): Promise<T> => {
        const res = await authFetch(path, init);
        if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}`);
        return (await res.json()) as T;
    };

    return {
        authFetch,
        get: <T>(path: string): Promise<T> => json<T>(path),
        post: <T>(path: string, body: unknown): Promise<T> =>
            json<T>(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) }),
        patch: <T>(path: string, body: unknown): Promise<T> =>
            json<T>(path, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) }),
    };
}
