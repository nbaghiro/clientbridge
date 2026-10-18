import { SessionEpoch } from "./epochs";

/** Who the app believes is signed in; mobile also holds its session token. */
export interface SessionCredentials {
    userId: string;
    sessionToken?: string;
}

interface SessionStore {
    get(): Promise<SessionCredentials | null>;
    clear(): Promise<void>;
}

interface SessionOptions {
    baseUrl: string;
    /** Web rides the session cookie; mobile sends its session token. */
    mode: "cookie" | "token";
    epoch?: SessionEpoch;
    store: SessionStore;
    /** Called once the session is gone (the auth service said 401) — the app should show login. */
    onSignedOut: () => void;
    /** Called when the session needs a second factor before the API answers. */
    onStepUp?: () => void;
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
    /** Authenticated fetch with the same sign-out-on-401 behavior — used by the PowerSync connector. */
    authFetch: (path: string, init?: RequestInit) => Promise<Response>;
    authFetchFor: (subject: string) => Session["authFetch"];
    forBusiness: (businessId: string | null) => Session;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

/** A request the API refused: its status and the stable `error` code of its body, never shown as text. */
export class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string | null,
        request: string,
    ) {
        super(`${request} → ${String(status)}`);
        this.name = "ApiError";
    }
}

async function errorCode(res: Response): Promise<string | null> {
    try {
        const body = (await res.clone().json()) as { error?: unknown };
        return typeof body.error === "string" ? body.error : null;
    } catch {
        return null;
    }
}

async function refused(res: Response, request: string): Promise<ApiError> {
    return new ApiError(res.status, await errorCode(res), request);
}

export function createSession(opts: SessionOptions): Session {
    const epoch = opts.epoch ?? new SessionEpoch();

    // Sign out only when the API says the session is gone; a network error or 5xx keeps it.
    const unauthorized = async (res: Response, generation: number): Promise<void> => {
        if (generation !== epoch.value) return;
        if ((await errorCode(res)) === "second_factor_required" && opts.onStepUp) {
            opts.onStepUp();
            return;
        }
        epoch.advance();
        try {
            await opts.store.clear();
        } finally {
            opts.onSignedOut();
        }
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
        const credentials = await opts.store.get();
        if (subject && credentials?.userId !== subject)
            throw new Error("replica session identity changed");
        const headers = new Headers(init.headers);
        if (opts.mode === "token" && credentials?.sessionToken)
            headers.set("X-Session-Token", credentials.sessionToken);
        if (subject) headers.set("X-Expected-User", subject);
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
                ...(opts.mode === "cookie" ? { credentials: "include" as const } : {}),
            });
            assertCurrent();
            if (res.status === 401) await unauthorized(res, generation);
            return res;
        } finally {
            signal.removeEventListener("abort", abort);
            init.signal?.removeEventListener("abort", abort);
        }
    };

    const json = async <T>(
        path: string,
        init?: RequestInit,
        businessId?: string | null,
    ): Promise<T> => {
        const generation = epoch.value;
        const res = await authFetch(path, init, undefined, businessId);
        if (!res.ok) throw await refused(res, `${init?.method ?? "GET"} ${path}`);
        const value = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
        if (generation !== epoch.value) throw new Error("session changed during response");
        return value;
    };

    const text = async (path: string, businessId?: string | null): Promise<string> => {
        const generation = epoch.value;
        const res = await authFetch(path, undefined, undefined, businessId);
        if (!res.ok) throw await refused(res, `GET ${path}`);
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
        patch: <T>(path: string, body: unknown, options?: PostOptions): Promise<T> =>
            json<T>(
                path,
                {
                    method: "PATCH",
                    headers: options?.idempotencyKey
                        ? { ...JSON_HEADERS, "Idempotency-Key": options.idempotencyKey }
                        : JSON_HEADERS,
                    body: JSON.stringify(body),
                },
                businessId,
            ),
        delete: <T>(path: string): Promise<T> => json<T>(path, { method: "DELETE" }, businessId),
    });
    return bound(null);
}
