import { type Session, createSession } from "@clientbridge/api-client";
import Constants from "expo-constants";

import { clearTokens, getTokens, setTokens } from "./auth";

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string };
const baseUrl = extra.apiUrl ?? "http://localhost:8701";

let signedOutHandler: () => void = () => undefined;

/** Register what happens when the session can't be refreshed (App flips to the login screen). */
export function onSignedOut(handler: () => void): void {
    signedOutHandler = handler;
}

export const api: Session = createSession({
    baseUrl,
    store: { get: getTokens, set: setTokens, clear: clearTokens },
    onSignedOut: () => {
        signedOutHandler();
    },
});
