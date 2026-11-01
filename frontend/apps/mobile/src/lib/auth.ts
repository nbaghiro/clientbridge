import { SessionEpoch } from "@clientbridge/api-client";
import { type Viewer, useCurrentViewer } from "@clientbridge/app-core";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

// The session token, and whose replica it opened once the API said who that is.
interface StoredSession {
    session_token: string;
    user_id: string | null;
    verified_at?: number;
}

const KEY = "cb_session";

// in memory as well, so a screen mounted later queries as this user from its first render
let currentUser: string | null = null;
const userListeners = new Set<() => void>();

function setCurrentUser(userId: string | null): void {
    if (currentUser === userId) return;
    currentUser = userId;
    for (const listener of userListeners) listener();
}

function subscribeUser(listener: () => void): () => void {
    userListeners.add(listener);
    return () => {
        userListeners.delete(listener);
    };
}

export function currentUserId(): string | null {
    return currentUser;
}

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
    setCurrentUser(null);
    await serialized(() => SecureStore.deleteItemAsync(KEY));
}

export async function signIn(sessionToken: string): Promise<void> {
    sessionEpoch.advance();
    await teardown();
    const session: StoredSession = { session_token: sessionToken, user_id: null };
    setCurrentUser(null);
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

export async function rememberUser(userId: string, checkedAt?: number): Promise<void> {
    await serialized(async () => {
        const session = await getSession();
        if (session === null) return;
        await SecureStore.setItemAsync(
            KEY,
            JSON.stringify({ ...session, user_id: userId, verified_at: checkedAt ?? 0 }),
        );
        setCurrentUser(userId);
    });
}

export async function clearSession(): Promise<void> {
    sessionEpoch.advance();
    await teardown();
    await forgetSession();
}

export function useUserId(): string | null {
    return useSyncExternalStore(subscribeUser, currentUserId);
}

export function useViewer(): Viewer | null {
    return useCurrentViewer(useUserId());
}

export function useRole(): string | null {
    return useViewer()?.role ?? null;
}
