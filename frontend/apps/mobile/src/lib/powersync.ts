import { AppSchema, createConnector } from "@clientbridge/sync";
import { PowerSyncDatabase } from "@powersync/react-native";
import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as { powersyncUrl?: string };
const powersyncUrl = extra.powersyncUrl ?? "http://localhost:8704";

export const db = new PowerSyncDatabase({
    schema: AppSchema,
    database: { dbFilename: "clientbridge.db" },
});

type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>;

/** Connect to PowerSync using the session's authenticated fetch (handles token refresh + sign-out). */
export async function connectPowerSync(authFetch: AuthFetch): Promise<void> {
    await db.connect(createConnector({ powersyncUrl, authFetch }));
}

/** Disconnect and wipe the local DB — used on sign-out so the next user starts clean. */
export async function signOut(): Promise<void> {
    await db.disconnectAndClear();
}
