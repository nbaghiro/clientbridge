import { type Session, createSession } from "@clientbridge/api-client";

import { clearTokens, getTokens, setTokens } from "./auth";

const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8701";

let signedOutHandler: () => void = () => undefined;

/** Register what happens when the session can't be refreshed (App flips to the login screen). */
export function onSignedOut(handler: () => void): void {
    signedOutHandler = handler;
}

export const api: Session = createSession({
    baseUrl,
    store: {
        get: () => Promise.resolve(getTokens()),
        set: (tokens) => {
            setTokens(tokens);
            return Promise.resolve();
        },
        clear: () => {
            clearTokens();
            return Promise.resolve();
        },
    },
    onSignedOut: () => {
        signedOutHandler();
    },
    // Serialize refresh across tabs so two tabs can't replay the same refresh token.
    // (lib.dom types request()'s result un-flattened; Web Locks resolves with fn()'s value.)
    lock: <T>(fn: () => Promise<T>): Promise<T> =>
        navigator.locks.request("cb-token-refresh", fn) as unknown as Promise<T>,
});
