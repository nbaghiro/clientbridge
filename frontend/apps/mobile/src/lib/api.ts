import { type Session, createIdentityClient, createSession } from "@clientbridge/api-client";
import * as WebBrowser from "expo-web-browser";

import { forgetSession, getSession, sessionEpoch } from "./auth";
import { apiUrl, authUrl } from "./config";

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

const AUTH_CALLBACK = "clientbridge://auth/callback";

export const identity = createIdentityClient({
    baseUrl: authUrl,
    mode: "native",
    sessionToken: async () => (await getSession())?.session_token ?? null,
    nativeReturnTo: AUTH_CALLBACK,
});

/** Google sign-in and re-authentication: the browser returns to the app with an exchange code. */
export async function openAuthSession(url: string): Promise<string | null> {
    const result = await WebBrowser.openAuthSessionAsync(url, AUTH_CALLBACK);
    return result.type === "success" ? result.url : null;
}

export function selectBusiness(businessId: string | null): void {
    api = session.forBusiness(businessId);
}
