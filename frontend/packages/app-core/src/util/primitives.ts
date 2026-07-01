// Small shared primitives: the domain-neutral visual tone + client-minted id/idempotency keys.

// Domain-neutral visual tone. Each platform maps it to its own tokens (Tailwind classes / RN colors).
export type Intent = "accent" | "success" | "warning" | "danger" | "neutral";

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
