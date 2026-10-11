import { type Session, createIdentityClient, createSession } from "@clientbridge/api-client";

import { forgetSession, getSession, sessionEpoch } from "./auth";
import { apiUrl, kratosUrl } from "./config";

export const apiBaseUrl = apiUrl;

let signedOutHandler: () => void = () => undefined;

export function onSignedOut(handler: () => void): void {
    signedOutHandler = handler;
}

const session = createSession({
    baseUrl: apiBaseUrl,
    mode: "token",
    epoch: sessionEpoch,
    store: {
        get: async () => {
            const stored = await getSession();
            return stored
                ? { userId: stored.user_id ?? "", sessionToken: stored.session_token }
                : null;
        },
        clear: forgetSession,
    },
    onSignedOut: () => {
        signedOutHandler();
    },
    // The token stays; the login screen sees the session wants a second factor.
    onStepUp: () => {
        signedOutHandler();
    },
});

export let api: Session = session;

export const identity = createIdentityClient({
    kratosUrl,
    mode: "native",
    sessionToken: async () => (await getSession())?.session_token ?? null,
    nativeReturnTo: "clientbridge://auth/callback",
});

export function selectBusiness(businessId: string | null): void {
    api = session.forBusiness(businessId);
}
