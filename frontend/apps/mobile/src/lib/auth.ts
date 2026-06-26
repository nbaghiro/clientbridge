import type { components } from "@clientbridge/api-client";
import * as SecureStore from "expo-secure-store";

export type TokenPair = components["schemas"]["TokenPair"];

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

export async function getAccessToken(): Promise<string> {
    return (await getTokens())?.access_token ?? "";
}
