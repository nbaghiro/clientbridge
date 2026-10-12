import { SessionEpoch } from "@clientbridge/api-client";
import { type Viewer, useCurrentViewer } from "@clientbridge/app-core";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";

// The Kratos session token, and whose replica it opened once the API said who that is.
interface StoredSession {
    session_token: string;
    user_id: string | null;
}

const KEY = "cb_session";

export const sessionEpoch = new SessionEpoch();
let teardown: () => Promise<void> = () => Promise.resolve();

export function beforeSessionReplace(handler: () => Promise<void>): void {
    teardown = handler;
}

export async function getSession(): Promise<StoredSession | null> {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
}

let storageTail: Promise<void> = Promise.resolve();

function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = storageTail.then(fn);
    storageTail = next.then(
        () => undefined,
        () => undefined,
    );
    return next;
}

export async function forgetSession(): Promise<void> {
    sessionEpoch.advance();
    await serialized(() => SecureStore.deleteItemAsync(KEY));
}

export async function signIn(sessionToken: string): Promise<void> {
    sessionEpoch.advance();
    await teardown();
    const session: StoredSession = { session_token: sessionToken, user_id: null };
    await serialized(() => SecureStore.setItemAsync(KEY, JSON.stringify(session)));
    sessionEpoch.advance();
}

/** The same person's refreshed session (Google re-authentication); the replica stays open. */
export async function keepSessionToken(sessionToken: string): Promise<void> {
    await serialized(async () => {
        const session = await getSession();
        if (session === null || session.session_token === sessionToken) return;
        await SecureStore.setItemAsync(
            KEY,
            JSON.stringify({ ...session, session_token: sessionToken }),
        );
    });
}

export async function rememberUser(userId: string): Promise<void> {
    await serialized(async () => {
        const session = await getSession();
        if (session === null || session.user_id === userId) return;
        await SecureStore.setItemAsync(KEY, JSON.stringify({ ...session, user_id: userId }));
    });
}

export async function clearSession(): Promise<void> {
    sessionEpoch.advance();
    await teardown();
    await forgetSession();
}

function useUserId(): string | null {
    const [userId, setUserId] = useState<string | null>(null);
    useEffect(() => {
        getSession()
            .then((s) => {
                setUserId(s?.user_id ?? null);
            })
            .catch(() => {
                setUserId(null);
            });
    }, []);
    return userId;
}

/** SecureStore is read once on mount, then the member resolves from the stored user. */
export function useViewer(): Viewer | null {
    return useCurrentViewer(useUserId());
}

export function useRole(): string | null {
    return useViewer()?.role ?? null;
}
