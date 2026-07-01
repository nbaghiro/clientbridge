import type { TokenPair } from "@clientbridge/api-client";
import { useCurrentRole } from "@clientbridge/app-core";

export type { TokenPair };

const KEY = "cb_tokens";

export function getTokens(): TokenPair | null {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TokenPair) : null;
}

export function setTokens(tokens: TokenPair): void {
    localStorage.setItem(KEY, JSON.stringify(tokens));
}

export function clearTokens(): void {
    localStorage.removeItem(KEY);
}

export function isAuthenticated(): boolean {
    return getTokens() !== null;
}

/** The signed-in user's role from the stored token — the (sync) web side of the token seam behind
 *  app-core's shared decode. Mobile's counterpart reads SecureStore asynchronously. */
export function useRole(): string | null {
    return useCurrentRole(getTokens()?.access_token ?? null);
}
