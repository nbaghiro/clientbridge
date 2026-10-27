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
    patch<T>(path: string, body: unknown, opts?: PostOptions): Promise<T>;
    delete<T>(path: string, opts?: PostOptions): Promise<T>;
}

const field = (e: unknown, name: "status" | "code" | "detail"): unknown =>
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

/** The values a refusal names alongside its code, such as how many visits or which day. */
type FailureDetail = Readonly<Record<string, unknown>>;

/** The `detail` a refused request carried; empty when it carried none. */
export function failedDetail(e: unknown): FailureDetail {
    const detail = field(e, "detail");
    return detail !== null && typeof detail === "object" && !Array.isArray(detail)
        ? (detail as FailureDetail)
        : {};
}

/** A refused public request, read the same way as a staff one: status, code and detail, never the text. */
export async function refusal(
    res: Response,
): Promise<Error & { status: number; code: string | null; detail: unknown }> {
    let code: string | null = null;
    let detail: unknown = null;
    try {
        const body = (await res.json()) as { error?: unknown; detail?: unknown };
        if (typeof body.error === "string") code = body.error;
        detail = body.detail ?? null;
    } catch {
        code = null;
    }
    return Object.assign(new Error(`${res.url} → ${String(res.status)}`), {
        status: res.status,
        code,
        detail,
    });
}

const detailCount = (d: FailureDetail): number => (typeof d.count === "number" ? d.count : 0);

// Failures the server names that read the same wherever they happen.
const FAILURES: Record<string, (detail: FailureDetail) => string> = {
    invalid_timezone: () => strings.api.invalidTimezone,
    out_of_stock: () => strings.api.outOfStock,
    pickup_window_taken: () => strings.api.pickupWindowTaken,
    shop_not_ready: () => strings.api.shopNotReady,
    mixed_currencies: () => strings.api.mixedCurrencies,
    slot_unavailable: () => strings.api.slotUnavailable,
    contact_ambiguous: () => strings.api.contactAmbiguous,
    class_seat: () => strings.api.classSeat,
    class_move: () => strings.api.classMove,
    recurrence_too_long: () => strings.api.recurrenceTooLong,
    idempotency_key_reused: () => strings.api.idempotencyKeyReused,
    concurrent_change: () => strings.api.concurrentChange,
    visit_not_started: () => strings.api.visitNotStarted,
    estimate_booked: () => strings.api.estimateBooked,
    estimate_on_visit: () => strings.api.estimateOnVisit,
    estimate_changed: () => strings.api.estimateChanged,
    deposit_not_due: () => strings.api.depositNotDue,
    deposit_in_progress: () => strings.api.depositInProgress,
    checkout_paid: () => strings.api.checkoutPaid,
    card_payments_unavailable: () => strings.api.cardPaymentsUnavailable,
    staff_has_future_work: () => strings.api.staffHasFutureWork,
    broadcast_address_missing: () => strings.api.broadcastAddressMissing,
    broadcast_contact_missing: () => strings.api.broadcastContactMissing,
    business_address_incomplete: () => strings.api.businessAddressIncomplete,
    postal_code_province_mismatch: () => strings.api.postalCodeProvinceMismatch,
    province_locked: () => strings.api.provinceLocked,
    plan_required: () => strings.api.planRequired,
    seat_limit: () => strings.api.seatLimit,
    plan_active: () => strings.api.planActive,
    plan_not_managed: () => strings.api.planNotManaged,
    business_unavailable: () => strings.api.businessUnavailable,
    review_recently_requested: () => strings.api.reviewRecentlyRequested,
    slug_invalid: () => strings.api.slugInvalid,
    slug_reserved: () => strings.api.slugReserved,
    slug_taken: () => strings.api.slugTaken,
    visit_not_billed: () => strings.api.visitNotBilled,
    service_not_offered: () => strings.api.serviceNotOffered,
    visit_no_room: () => strings.api.visitNoRoom,
    crew_busy: () => strings.api.crewBusy,
    resource_busy: () => strings.api.resourceBusy,
    no_resource: () => strings.api.noResource,
    resource_not_in_pool: () => strings.api.resourceNotInPool,
    resource_name_taken: () => strings.api.resourceNameTaken,
    crew_member: () => strings.api.crewMember,
    crew_block: () => strings.api.crewBlock,
    visit_started: () => strings.api.visitStarted,
    package_other_subject: () => strings.api.packageOtherSubject,
    visit_unpaid: () => strings.api.visitUnpaid,
    program_full: () => strings.api.programFull,
    already_enrolled: () => strings.api.alreadyEnrolled,
    program_enrol: () => strings.api.programEnrol,
    program_first_day: () => strings.api.programFirstDay,
    program_enrolled: () => strings.api.programEnrolled,
    program_closed: () => strings.api.programClosed,
    program_over: () => strings.api.programOver,
    program_days: () => strings.api.programDays,
    schedule_conflict: () => strings.api.scheduleConflict,
    schedule_past: () => strings.api.schedulePast,
    class_schedule: () => strings.api.classSchedule,
    addon_length_in_use: (d) => strings.api.addonLengthInUse(detailCount(d)),
    enrolment_paid: () => strings.api.enrolmentPaid,
    payment_disputed: () => strings.api.paymentDisputed,
    amount_too_small: () => strings.api.amountTooSmall,
    idempotency_mismatch: () => strings.api.idempotencyMismatch,
    payment_provider_error: () => strings.api.paymentProviderError,
};

/** The catalog message for a failure the server named, else the action's own message. */
export function failureMessage(e: unknown, fallback: string): string {
    const code = failedCode(e);
    const known = code === null ? undefined : FAILURES[code];
    return known === undefined ? fallback : known(failedDetail(e));
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

// The slice of the auth service client the auth hooks drive (web: browser flows; mobile: native flows).
export interface IdentityLike {
    start(
        kind: FlowKind,
        opts?: {
            secondFactor?: boolean | undefined;
            refresh?: boolean | undefined;
            returnTo?: string | undefined;
            sessionToken?: string | undefined;
        },
    ): Promise<Flow>;
    resume(kind: FlowKind, id: string, sessionToken?: string): Promise<Flow>;
    submit(flow: Flow, body: Record<string, unknown>, sessionToken?: string): Promise<FlowStep>;
    session(sessionToken?: string): Promise<"active" | "second_factor" | "none">;
    whoami(sessionToken?: string): Promise<{ id: string; email: string } | null>;
    exchange(flow: Flow, returnToCode: string): Promise<string>;
    signOut(sessionToken?: string): Promise<void>;
}

// WebAuthn needs the browser's credential API; mobile leaves it out (TOTP and backup codes only).
export interface WebAuthnLike {
    register(options: string): Promise<string>;
    login(options: string): Promise<string>;
}
