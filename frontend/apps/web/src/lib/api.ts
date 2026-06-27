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
});
