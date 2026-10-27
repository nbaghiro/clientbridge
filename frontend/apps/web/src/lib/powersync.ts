import type { Session } from "@clientbridge/api-client";
import { AppSchema, createConnector, ReplicaController } from "@clientbridge/sync";
import { PowerSyncDatabase } from "@powersync/web";
import { beforeSessionReplace, getUserId } from "./auth";
import { config } from "../config";

const { apiUrl, powersyncUrl } = config;

export const replica = new ReplicaController(
    (dbFilename) =>
        new PowerSyncDatabase({
            schema: AppSchema,
            database: { dbFilename },
        }),
);

beforeSessionReplace(() => replica.pause());

export async function connectPowerSync(api: Session) {
    const userId = getUserId();
    if (!userId) throw new Error("a valid account identity is required");
    const db = await replica.activate(
        { userId, apiUrl, powersyncUrl },
        createConnector({ powersyncUrl, authFetch: api.forBusiness(null).authFetchFor(userId) }),
    );
    // without persistence the browser may evict the replica, and unsent edits with it
    if ("storage" in navigator) {
        navigator.storage.persist().catch(() => undefined);
    }
    return db;
}

export function signOut(): Promise<void> {
    return replica.discard();
}

export { powersyncUrl };
