import { createSession } from "@clientbridge/api-client";
import {
    clearSavedTokens,
    getTokens,
    saveTokens,
    sessionEpoch,
    withSessionLock,
    onSessionChanged,
    setTokens,
    clearTokens,
} from "../../../apps/web/src/lib/auth";

export { getTokens, setTokens, clearTokens };
export const events = { changed: 0, signedOut: 0 };
onSessionChanged(() => {
    events.changed++;
});
export const api = createSession({
    baseUrl: "/auth-test",
    epoch: sessionEpoch,
    lock: withSessionLock,
    store: { get: () => Promise.resolve(getTokens()), set: saveTokens, clear: clearSavedTokens },
    onSignedOut: () => {
        events.signedOut++;
    },
});
