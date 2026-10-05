import { type Session, createSession } from "@clientbridge/api-client";
import Constants from "expo-constants";

import { clearTokens, getTokens, setTokens } from "./auth";

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string };
export const apiBaseUrl = extra.apiUrl ?? "http://localhost:8701";

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
