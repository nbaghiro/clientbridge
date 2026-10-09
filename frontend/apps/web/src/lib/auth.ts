import { SessionEpoch, sessionIdentity, type TokenPair } from "@clientbridge/api-client";
import { type Viewer, useCurrentRole, useCurrentViewer } from "@clientbridge/app-core";

export type { TokenPair };

const KEY = "cb_tokens";

export const sessionEpoch = new SessionEpoch();
let teardown: () => Promise<void> = () => Promise.resolve();

export function beforeSessionReplace(handler: () => Promise<void>): void {
    teardown = handler;
}

export function getTokens(): TokenPair | null {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TokenPair) : null;
}

export function withSessionLock<T>(fn: () => Promise<T>): Promise<T> {
    const locks = (navigator as { locks?: LockManager }).locks;
    if (!locks) return Promise.reject(new Error("secure session coordination is unavailable"));
    return locks.request("cb-auth-session", fn);
}

export function saveTokens(tokens: TokenPair): Promise<void> {
    localStorage.setItem(KEY, JSON.stringify(tokens));
    return Promise.resolve();
}

export function clearSavedTokens(): Promise<void> {
    sessionEpoch.advance();
    localStorage.removeItem(KEY);
    return Promise.resolve();
}

export async function setTokens(tokens: TokenPair): Promise<void> {
    sessionEpoch.advance();
    await teardown();
    await withSessionLock(() => saveTokens(tokens));
    sessionEpoch.advance();
}

export async function clearTokens(): Promise<void> {
    sessionEpoch.advance();
    await teardown();
    await withSessionLock(clearSavedTokens);
}

export function isAuthenticated(): boolean {
    return getTokens() !== null;
}

/** Web reads the token synchronously; mobile reads SecureStore asynchronously. */
export function useRole(): string | null {
    return useCurrentRole(getTokens()?.access_token ?? null);
}

export function useViewer(): Viewer | null {
    return useCurrentViewer(getTokens()?.access_token ?? null);
}

let changed: () => void = () => undefined;

export function onSessionChanged(handler: () => void): void {
    changed = handler;
}

function storedIdentity(raw: string | null): string | null {
    if (!raw) return null;
    try {
        return sessionIdentity((JSON.parse(raw) as TokenPair).access_token);
    } catch {
        return null;
    }
}

function storageChanged(event: StorageEvent): void {
    if (event.storageArea !== localStorage) return;
    if (
        event.key === null ||
        (event.key === KEY && storedIdentity(event.oldValue) !== storedIdentity(event.newValue))
    ) {
        sessionEpoch.advance();
        changed();
    }
}

window.addEventListener("storage", storageChanged);
import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", storageChanged);
});
