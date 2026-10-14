import { SessionEpoch } from "@clientbridge/api-client";
import { type Viewer, useCurrentRole, useCurrentViewer } from "@clientbridge/app-core";

// The session is an HttpOnly cookie; this only remembers whose replica is open.
const KEY = "cb_user";

export const sessionEpoch = new SessionEpoch();
let teardown: () => Promise<void> = () => Promise.resolve();

export function beforeSessionReplace(handler: () => Promise<void>): void {
    teardown = handler;
}

export function getUserId(): string | null {
    return localStorage.getItem(KEY);
}

// Set by a finished sign-in, so the next restore asks the API who it is.
let signedIn = new URLSearchParams(window.location.search).has("session");
// The auth service set its cookie before the app signed in (sign-up awaiting verification); survives reloads.
const HINT = "cb_session_hint";

export function expectSession(): void {
    signedIn = true;
}

export function hintSession(): void {
    localStorage.setItem(HINT, "1");
}

export function sessionHinted(): boolean {
    return localStorage.getItem(HINT) !== null;
}

export function sessionExpected(): boolean {
    const expected = signedIn || getUserId() !== null || sessionHinted();
    signedIn = false;
    return expected;
}

// An invite token waits here (never in a URL); a new tab from an emailed link finds it too.
const INVITE = "cb_invite";
const INVITE_HOLD_MS = 60 * 60 * 1000;

export function holdInvite(token: string): void {
    try {
        localStorage.setItem(INVITE, JSON.stringify({ token, until: Date.now() + INVITE_HOLD_MS }));
    } catch {
        return;
    }
}

export function heldInvite(): string | null {
    try {
        const held = JSON.parse(localStorage.getItem(INVITE) ?? "null") as {
            token?: unknown;
            until?: unknown;
        } | null;
        if (typeof held?.token === "string" && typeof held.until === "number") {
            if (held.until > Date.now()) return held.token;
        }
        localStorage.removeItem(INVITE);
        return null;
    } catch {
        return null;
    }
}

export function releaseInvite(): void {
    try {
        localStorage.removeItem(INVITE);
    } catch {
        return;
    }
}

export function forgetUser(): Promise<void> {
    sessionEpoch.advance();
    localStorage.removeItem(KEY);
    localStorage.removeItem(HINT);
    return Promise.resolve();
}

export async function rememberUser(userId: string): Promise<void> {
    if (getUserId() === userId) return;
    sessionEpoch.advance();
    await teardown();
    localStorage.setItem(KEY, userId);
    localStorage.removeItem(HINT);
    sessionEpoch.advance();
}

export async function clearUser(): Promise<void> {
    sessionEpoch.advance();
    await teardown();
    await forgetUser();
}

export function useRole(): string | null {
    return useCurrentRole(getUserId());
}

export function useViewer(): Viewer | null {
    return useCurrentViewer(getUserId());
}

let changed: () => void = () => undefined;

export function onSessionChanged(handler: () => void): void {
    changed = handler;
}

function storageChanged(event: StorageEvent): void {
    if (event.storageArea !== localStorage) return;
    if (event.key === null || (event.key === KEY && event.oldValue !== event.newValue)) {
        sessionEpoch.advance();
        changed();
    }
}

window.addEventListener("storage", storageChanged);
import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", storageChanged);
});
