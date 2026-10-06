import { type Session, createSession } from "@clientbridge/api-client";

import { clearTokens, getTokens, setTokens } from "./auth";
import { apiUrl } from "./config";

export const apiBaseUrl = apiUrl;

let signedOutHandler: () => void = () => undefined;

export function onSignedOut(handler: () => void): void {
    signedOutHandler = handler;
}

export const api: Session = createSession({
    baseUrl: apiBaseUrl,
    store: { get: getTokens, set: setTokens, clear: clearTokens },
    onSignedOut: () => {
        signedOutHandler();
    },
});
