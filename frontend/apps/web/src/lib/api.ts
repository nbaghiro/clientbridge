import { type Session, createIdentityClient, createSession } from "@clientbridge/api-client";
import { setPhotoApi } from "@clientbridge/app-core";

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
    // The session cookie stays; the login screen sees the session wants a second factor.
    onStepUp: () => {
        signedOutHandler();
    },
});

export let api: Session = session;
setPhotoApi(api);

export const identity = createIdentityClient({ baseUrl: config.authUrl, mode: "browser" });

export function selectBusiness(businessId: string | null): void {
    api = session.forBusiness(businessId);
    setPhotoApi(api);
}
