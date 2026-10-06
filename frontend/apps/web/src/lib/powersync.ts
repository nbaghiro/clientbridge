import { AppSchema, createConnector } from "@clientbridge/sync";
import { PowerSyncDatabase } from "@powersync/web";

import { config } from "../config";

const powersyncUrl = config.powersyncUrl;

export const db = new PowerSyncDatabase({
    schema: AppSchema,
    database: { dbFilename: "clientbridge.db" },
});

type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>;

export async function connectPowerSync(authFetch: AuthFetch): Promise<void> {
    await db.connect(createConnector({ powersyncUrl, authFetch }));
}

/** Disconnect and wipe the local DB — used on sign-out so the next user starts clean. */
export async function signOut(): Promise<void> {
    await db.disconnectAndClear();
}

export { powersyncUrl };
