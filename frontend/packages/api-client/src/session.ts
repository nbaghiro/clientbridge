import { SessionEpoch } from "./epochs";
import { sessionSubject } from "./identity";

export interface TokenPair {
    access_token: string;
    refresh_token: string;
    token_type?: string;
    refresh_attempt_id?: string;
}

interface SessionStore {
    get(): Promise<TokenPair | null>;
    set(tokens: TokenPair): Promise<void>;
    clear(): Promise<void>;
}

interface SessionOptions {
    baseUrl: string;
    epoch?: SessionEpoch;
    store: SessionStore;
    /** Called once the session is unrecoverable (refresh failed) — the app should show login. */
    onSignedOut: () => void;
    /** Optional cross-context lock for the refresh (web: Web Locks; mobile: omit, single instance). */
    lock?: <T>(fn: () => Promise<T>) => Promise<T>;
}

/** `idempotencyKey` is sent as `Idempotency-Key` so a retried command dedups server-side. */
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
    authFetchFor: (subject: string) => Session["authFetch"];
    forBusiness: (businessId: string | null) => Session;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function createSession(opts: SessionOptions): Session {
    const runLocked = opts.lock ?? (<T>(fn: () => Promise<T>) => fn());
    const epoch = opts.epoch ?? new SessionEpoch();
    let pending: { generation: number; promise: Promise<boolean> } | null = null;

    // Sign out only on a definitive 401/403; a network error or 5xx keeps the tokens for a retry.
    const doRefresh = async (generation: number): Promise<boolean> => {
        const tokens = await opts.store.get();
        if (tokens === null) return false; // not logged in (e.g. a failed login) — nothing to refresh
        if (generation !== epoch.value) return false;
        const attempt = tokens.refresh_attempt_id ?? crypto.randomUUID();
        if (!tokens.refresh_attempt_id)
            await opts.store.set({ ...tokens, refresh_attempt_id: attempt });
        if (generation !== epoch.value) return false;
        const timeout = new AbortController();
        const abort = (): void => {
            timeout.abort();
        };
        const signal = epoch.signal;
        signal.addEventListener("abort", abort, { once: true });
        const timer = setTimeout(abort, 15_000);
        try {
            const res = await fetch(`${opts.baseUrl}/auth/refresh`, {
                method: "POST",
                signal: timeout.signal,
                headers: JSON_HEADERS,
                body: JSON.stringify({ refresh_token: tokens.refresh_token, attempt_id: attempt }),
            });
            if (generation !== epoch.value) return false;
            if (res.ok) {
                const replacement = (await res.json()) as TokenPair;
                if (generation !== epoch.value) return false;
                await opts.store.set(replacement);
                return true;
            }
            if (res.status === 401 || res.status === 403) {
                epoch.advance();
                try {
                    await opts.store.clear();
                } finally {
                    opts.onSignedOut();
                }
            }
            return false;
        } catch {
            return false;
        } finally {
            clearTimeout(timer);
            signal.removeEventListener("abort", abort);
        }
    };

    // One refresh at a time across tabs, so two contexts never replay a refresh token (that revokes the family).
    const recover = (staleToken: string): Promise<boolean> => {
        const generation = epoch.value;
        if (pending?.generation === generation) return pending.promise;
        const promise = runLocked(async () => {
            if (generation !== epoch.value) return false;
            const current = (await opts.store.get())?.access_token ?? "";
            if (current !== "" && current !== staleToken) return true;
            return doRefresh(generation);
        }).finally(() => {
            if (pending?.promise === promise) pending = null;
        });
        pending = { generation, promise };
        return promise;
    };

    const authFetch = async (
        path: string,
        init: RequestInit = {},
        subject?: string,
        businessId?: string | null,
    ): Promise<Response> => {
        const generation = epoch.value;
        const assertCurrent = (): void => {
            if (generation !== epoch.value) throw new Error("session changed during request");
        };
        const send = async (): Promise<{ res: Response; token: string }> => {
            const token = (await opts.store.get())?.access_token ?? "";
            if (subject && sessionSubject(token) !== subject)
                throw new Error("replica session identity changed");
            const headers = new Headers(init.headers);
            if (token) headers.set("Authorization", `Bearer ${token}`);
            if (businessId) headers.set("X-Business-Id", businessId);
            assertCurrent();
            const controller = new AbortController();
            const signal = epoch.signal;
            const abort = (): void => {
                controller.abort();
            };
            signal.addEventListener("abort", abort, { once: true });
            init.signal?.addEventListener("abort", abort, { once: true });
            if (init.signal?.aborted) controller.abort();
            try {
                const res = await fetch(`${opts.baseUrl}${path}`, {
                    ...init,
                    headers,
                    signal: controller.signal,
                });
                assertCurrent();
                return { res, token };
            } finally {
                signal.removeEventListener("abort", abort);
                init.signal?.removeEventListener("abort", abort);
            }
        };
        const first = await send();
        if (first.res.status === 401 && (await recover(first.token))) return (await send()).res;
        return first.res;
    };

    const json = async <T>(
        path: string,
        init?: RequestInit,
        businessId?: string | null,
    ): Promise<T> => {
        const generation = epoch.value;
        const res = await authFetch(path, init, undefined, businessId);
        if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}`);
        const value = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
        if (generation !== epoch.value) throw new Error("session changed during response");
        return value;
    };

    const text = async (path: string, businessId?: string | null): Promise<string> => {
        const generation = epoch.value;
        const res = await authFetch(path, undefined, undefined, businessId);
        if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
        const value = await res.text();
        if (generation !== epoch.value) throw new Error("session changed during response");
        return value;
    };

    const bound = (businessId: string | null): Session => ({
        authFetch: (path, init) => authFetch(path, init, undefined, businessId),
        authFetchFor: (subject) => (path, init) => authFetch(path, init, subject, businessId),
        forBusiness: bound,
        get: <T>(path: string): Promise<T> => json<T>(path, undefined, businessId),
        getText: (path: string): Promise<string> => text(path, businessId),
        post: <T>(path: string, body: unknown, options?: PostOptions): Promise<T> =>
            json<T>(
                path,
                {
                    method: "POST",
                    headers: options?.idempotencyKey
                        ? { ...JSON_HEADERS, "Idempotency-Key": options.idempotencyKey }
                        : JSON_HEADERS,
                    body: JSON.stringify(body),
                },
                businessId,
            ),
        patch: <T>(path: string, body: unknown): Promise<T> =>
            json<T>(
                path,
                { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) },
                businessId,
            ),
        delete: <T>(path: string): Promise<T> => json<T>(path, { method: "DELETE" }, businessId),
    });
    return bound(null);
}
