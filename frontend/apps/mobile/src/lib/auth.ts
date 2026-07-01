import type { TokenPair } from "@clientbridge/api-client";
import { useCurrentRole } from "@clientbridge/app-core";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";

export type { TokenPair };

const KEY = "cb_tokens";

export async function getTokens(): Promise<TokenPair | null> {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as TokenPair) : null;
}

export async function setTokens(tokens: TokenPair): Promise<void> {
    await SecureStore.setItemAsync(KEY, JSON.stringify(tokens));
}

export async function clearTokens(): Promise<void> {
    await SecureStore.deleteItemAsync(KEY);
}

/** The signed-in user's role — the (async) mobile side of the token seam behind app-core's shared
 *  decode: SecureStore is read once on mount, then the role resolves from the token. */
export function useRole(): string | null {
    const [token, setToken] = useState<string | null>(null);
    useEffect(() => {
        getTokens()
            .then((t) => {
                setToken(t?.access_token ?? null);
            })
            .catch(() => {
                setToken(null);
            });
    }, []);
    return useCurrentRole(token);
}
