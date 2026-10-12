import { createSession } from "@clientbridge/api-client";
import {
    clearUser,
    forgetUser,
    getUserId,
    onSessionChanged,
    rememberUser,
    sessionEpoch,
} from "../../../apps/web/src/lib/auth";

export { getUserId, rememberUser, clearUser };
export const events = { changed: 0, signedOut: 0 };
onSessionChanged(() => {
    events.changed++;
});
export const api = createSession({
    baseUrl: "/auth-test",
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
        events.signedOut++;
    },
});
