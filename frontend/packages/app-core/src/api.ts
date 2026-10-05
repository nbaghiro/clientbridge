// Per-request options for a write. `idempotencyKey` dedups a retried money/uniqueness command
// server-side (sent as the `Idempotency-Key` header).
export interface PostOptions {
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

/** A fresh idempotency key for one write attempt, reused across that attempt's retries so the server
 *  dedups instead of double-charging. `crypto.randomUUID` is available on web and RN (Hermes). */
export function newIdempotencyKey(): string {
    return crypto.randomUUID();
}

/** A client-minted row id for a sync-write insert (`prefix_<uuid>`). On `/sync/upload` the client id
 *  is authoritative and unchecked for shape, so this only has to be unique. */
export function newRowId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID()}`;
}
