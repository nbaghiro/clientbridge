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
    /** Optional cross-context lock for the refresh (web: Web Locks; mobile: omit, single instance). */
    lock?: <T>(fn: () => Promise<T>) => Promise<T>;
}

/** Per-request write options. `idempotencyKey` is sent as the `Idempotency-Key` header so a retried
 *  money/uniqueness command dedups server-side. */
export interface PostOptions {
    idempotencyKey?: string;
}

export interface Session {
    get<T>(path: string): Promise<T>;
    /** Authenticated GET returning the raw body text (non-JSON endpoints, e.g. report .csv exports). */
    getText(path: string): Promise<string>;
    post<T>(path: string, body: unknown, opts?: PostOptions): Promise<T>;
    patch<T>(path: string, body: unknown): Promise<T>;
    delete<T>(path: string): Promise<T>;
    /** Authenticated fetch with the same refresh-on-401 behavior — used by the PowerSync connector. */
    authFetch: (path: string, init?: RequestInit) => Promise<Response>;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function createSession(opts: SessionOptions): Session {
    const runLocked = opts.lock ?? (<T>(fn: () => Promise<T>) => fn());
    let pending: Promise<boolean> | null = null;

    // POST /auth/refresh. Signs out ONLY on a definitive 401/403; a network error or 5xx keeps the
    // tokens so the request can retry later (a transient blip must not log everyone out + wipe data).
    const doRefresh = async (): Promise<boolean> => {
        const tokens = await opts.store.get();
        if (tokens === null) return false; // not logged in (e.g. a failed login) — nothing to refresh
        let res: Response;
        try {
            res = await fetch(`${opts.baseUrl}/auth/refresh`, {
                method: "POST",
                headers: JSON_HEADERS,
                body: JSON.stringify({ refresh_token: tokens.refresh_token }),
            });
        } catch {
            return false; // network blip — keep tokens
        }
        if (res.ok) {
            await opts.store.set((await res.json()) as TokenPair);
            return true;
        }
        if (res.status === 401 || res.status === 403) {
            await opts.store.clear();
            opts.onSignedOut();
        }
        return false;
    };

    // Single-flight (in-context) + cross-context serialized (the lock). `staleToken` is the access
    // token whose request 401'd; if another tab/context already rotated, skip the refresh and retry —
    // this prevents two contexts replaying the same refresh token (which revokes the whole family).
    const recover = (staleToken: string): Promise<boolean> => {
        pending ??= runLocked(async () => {
            const current = (await opts.store.get())?.access_token ?? "";
            if (current !== "" && current !== staleToken) return true;
            return doRefresh();
        }).finally(() => {
            pending = null;
        });
        return pending;
    };

    const authFetch = async (path: string, init: RequestInit = {}): Promise<Response> => {
        const send = async (): Promise<{ res: Response; token: string }> => {
            const token = (await opts.store.get())?.access_token ?? "";
            const headers: Record<string, string> = {
                ...(init.headers as Record<string, string> | undefined),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            };
            return { res: await fetch(`${opts.baseUrl}${path}`, { ...init, headers }), token };
        };
        const first = await send();
        if (first.res.status === 401 && (await recover(first.token))) return (await send()).res;
        return first.res;
    };

    const json = async <T>(path: string, init?: RequestInit): Promise<T> => {
        const res = await authFetch(path, init);
        if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}`);
        return (await res.json()) as T;
    };

    const text = async (path: string): Promise<string> => {
        const res = await authFetch(path);
        if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
        return res.text();
    };

    return {
        authFetch,
        get: <T>(path: string): Promise<T> => json<T>(path),
        getText: (path: string): Promise<string> => text(path),
        post: <T>(path: string, body: unknown, opts?: PostOptions): Promise<T> =>
            json<T>(path, {
                method: "POST",
                headers: opts?.idempotencyKey
                    ? { ...JSON_HEADERS, "Idempotency-Key": opts.idempotencyKey }
                    : JSON_HEADERS,
                body: JSON.stringify(body),
            }),
        patch: <T>(path: string, body: unknown): Promise<T> =>
            json<T>(path, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) }),
        delete: <T>(path: string): Promise<T> =>
            json<T>(path, { method: "DELETE", headers: JSON_HEADERS }),
    };
}
