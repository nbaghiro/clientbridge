/** A fresh idempotency key for one write attempt, reused across that attempt's retries so the server
 *  dedups instead of double-charging. `crypto.randomUUID` is available on web and RN (Hermes). */
export function newIdempotencyKey(): string {
    return crypto.randomUUID();
}
