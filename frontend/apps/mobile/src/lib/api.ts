import { type Session, createSession } from "@clientbridge/api-client";

import { clearSavedTokens, getTokens, saveTokens, sessionEpoch, withSessionLock } from "./auth";
import { apiUrl } from "./config";

export const apiBaseUrl = apiUrl;

let signedOutHandler: () => void = () => undefined;

export function onSignedOut(handler: () => void): void {
    signedOutHandler = handler;
}

const session = createSession({
    baseUrl: apiBaseUrl,
    epoch: sessionEpoch,
    lock: withSessionLock,
    store: { get: () => Promise.resolve(getTokens()), set: saveTokens, clear: clearSavedTokens },
    onSignedOut: () => {
        signedOutHandler();
    },
});

export let api: Session = session;

export function selectBusiness(businessId: string | null): void {
    api = session.forBusiness(businessId);
}
