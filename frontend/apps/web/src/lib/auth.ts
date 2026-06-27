import type { TokenPair } from "@clientbridge/api-client";

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
