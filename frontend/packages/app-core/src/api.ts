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
    concurrent_change: () => strings.api.concurrentChange,
    visit_not_started: () => strings.api.visitNotStarted,
    staff_has_future_work: () => strings.api.staffHasFutureWork,
    broadcast_address_missing: () => strings.api.broadcastAddressMissing,
    broadcast_contact_missing: () => strings.api.broadcastContactMissing,
    business_address_incomplete: () => strings.api.businessAddressIncomplete,
    plan_required: () => strings.api.planRequired,
    seat_limit: () => strings.api.seatLimit,
    plan_active: () => strings.api.planActive,
    plan_not_managed: () => strings.api.planNotManaged,
    business_unavailable: () => strings.api.businessUnavailable,
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

// Matches api-client's IdentityClient; kept local so app-core needn't depend on api-client.
type FlowKind = "login" | "registration" | "recovery" | "verification" | "settings";

export interface FlowMessage {
    id: number;
    type: string;
    text: string;
}

export interface FlowNode {
    group: string;
    name: string;
    kind: string;
    type?: string;
    value: unknown;
    src?: string;
    text?: string;
    label?: string;
    context?: Record<string, unknown>;
    messages: FlowMessage[];
}

export interface Flow {
    id: string;
    kind: FlowKind;
    state: string | null;
    messages: FlowMessage[];
    nodes: FlowNode[];
    exchangeCode?: string;
}

export type FlowStep =
    | {
          kind: "done";
          sessionToken?: string;
          next?: { flow: "verification" | "settings"; id: string };
      }
    | { kind: "flow"; flow: Flow }
    | { kind: "redirect"; url: string }
    | { kind: "reauth" }
    | { kind: "restart" };

// The slice of the Kratos client the auth hooks drive (web: browser flows; mobile: native flows).
export interface IdentityLike {
    start(
        kind: FlowKind,
        opts?: {
            aal?: "aal2" | undefined;
            refresh?: boolean | undefined;
            returnTo?: string | undefined;
            sessionToken?: string | undefined;
        },
    ): Promise<Flow>;
    resume(kind: FlowKind, id: string, sessionToken?: string): Promise<Flow>;
    submit(flow: Flow, body: Record<string, unknown>, sessionToken?: string): Promise<FlowStep>;
    session(sessionToken?: string): Promise<"active" | "aal2" | "none">;
    whoami(sessionToken?: string): Promise<{ id: string; email: string } | null>;
    exchange(flow: Flow, returnToCode: string): Promise<string>;
    signOut(sessionToken?: string): Promise<void>;
}

// WebAuthn needs the browser's credential API; mobile leaves it out (TOTP and backup codes only).
export interface WebAuthnLike {
    register(options: string): Promise<string>;
    login(options: string): Promise<string>;
}
