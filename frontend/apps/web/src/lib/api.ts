import { type Session, createIdentityClient, createSession } from "@clientbridge/api-client";

import { config } from "../config";
import { forgetUser, getUserId, sessionEpoch } from "./auth";

export const apiBaseUrl = config.apiUrl;

let signedOutHandler: () => void = () => undefined;

export function onSignedOut(handler: () => void): void {
    signedOutHandler = handler;
}

const session = createSession({
    baseUrl: apiBaseUrl,
    mode: "cookie",
    epoch: sessionEpoch,
    store: {
        get: () => {
            const userId = getUserId();
            return Promise.resolve(userId ? { userId } : null);
        },
        clear: forgetUser,
    },
    onSignedOut: () => {
        signedOutHandler();
    },
    // The Kratos cookie stays; the login screen sees the session wants a second factor.
    onStepUp: () => {
        signedOutHandler();
    },
});

export let api: Session = session;

export const identity = createIdentityClient({ kratosUrl: config.kratosUrl, mode: "browser" });

export function selectBusiness(businessId: string | null): void {
    api = session.forBusiness(businessId);
}
