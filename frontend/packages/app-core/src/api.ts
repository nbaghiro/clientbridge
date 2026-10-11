import { strings } from "./strings";

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

const field = (e: unknown, name: "status" | "code"): unknown =>
    e !== null && typeof e === "object" && name in e ? (e as Record<string, unknown>)[name] : null;

/** The HTTP status of a refused request; the message shown comes from the catalog. */
export function failedStatus(e: unknown): number | null {
    const status = field(e, "status");
    return typeof status === "number" ? status : null;
}

/** The stable `error` code a refused request carried, such as "invalid_timezone". */
export function failedCode(e: unknown): string | null {
    const code = field(e, "code");
    return typeof code === "string" ? code : null;
}

/** A refused public request, read the same way as a staff one: status and code, never the text. */
export async function refusal(
    res: Response,
): Promise<Error & { status: number; code: string | null }> {
    let code: string | null = null;
    try {
        const body = (await res.json()) as { error?: unknown };
        if (typeof body.error === "string") code = body.error;
    } catch {
        code = null;
    }
    return Object.assign(new Error(`${res.url} → ${String(res.status)}`), {
        status: res.status,
        code,
    });
}

// Failures the server names that read the same wherever they happen.
const FAILURES: Record<string, () => string> = {
    invalid_timezone: () => strings.api.invalidTimezone,
    out_of_stock: () => strings.api.outOfStock,
    pickup_window_taken: () => strings.api.pickupWindowTaken,
    shop_not_ready: () => strings.api.shopNotReady,
    mixed_currencies: () => strings.api.mixedCurrencies,
    slot_unavailable: () => strings.api.slotUnavailable,
    class_seat: () => strings.api.classSeat,
    class_move: () => strings.api.classMove,
    recurrence_too_long: () => strings.api.recurrenceTooLong,
    idempotency_key_reused: () => strings.api.idempotencyKeyReused,
};

/** The catalog message for a failure the server named, else the action's own message. */
export function failureMessage(e: unknown, fallback: string): string {
    const code = failedCode(e);
    const known = code === null ? undefined : FAILURES[code];
    return known === undefined ? fallback : known();
}

/** One key per write attempt, reused across its retries so the server dedups instead of double-charging. */
export function newIdempotencyKey(): string {
    return crypto.randomUUID();
}

export interface Attempt {
    key: string;
    request: string;
}

/** The attempt's key: kept across retries of the same request, renewed when the request changes. */
export function attemptKey(ref: { current: Attempt | null }, request: unknown): string {
    const fingerprint = JSON.stringify(request);
    if (ref.current?.request !== fingerprint) {
        ref.current = { key: newIdempotencyKey(), request: fingerprint };
    }
    return ref.current.key;
}

/** Sends the attempt, and once more with a fresh key if the server saved it for other details. */
export async function sendAttempt<T>(
    ref: { current: Attempt | null },
    request: unknown,
    send: (key: string) => Promise<T>,
): Promise<T> {
    try {
        return await send(attemptKey(ref, request));
    } catch (e) {
        if (failedCode(e) !== "idempotency_key_reused") throw e;
        ref.current = null;
        return send(attemptKey(ref, request));
    }
}
