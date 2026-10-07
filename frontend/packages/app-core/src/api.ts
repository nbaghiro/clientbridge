interface PostOptions {
    idempotencyKey?: string;
}

// The slice of each app's session client that the shared mutations need (web + mobile build their own).
export interface ApiLike {
    get<T>(path: string): Promise<T>;
    // Authenticated GET returning the raw body (for non-JSON endpoints like report .csv exports).
    getText(path: string): Promise<string>;
    post<T>(path: string, body: unknown, opts?: PostOptions): Promise<T>;
    patch<T>(path: string, body: unknown): Promise<T>;
    delete<T>(path: string): Promise<T>;
}

// The api client throws "POST /auth/login → 429"; the status decides which message to show.
export function failedStatus(e: unknown): number | null {
    const m = e instanceof Error ? /→ (\d{3})$/.exec(e.message) : null;
    return m?.[1] === undefined ? null : Number(m[1]);
}

/** One key per write attempt, reused across its retries so the server dedups instead of double-charging. */
export function newIdempotencyKey(): string {
    return crypto.randomUUID();
}

/** The client id is authoritative on `/sync/upload`, so it only has to be unique. */
export function newRowId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID()}`;
}
