import type { Session } from "@clientbridge/api-client";
import { AppSchema, createConnector, ReplicaController } from "@clientbridge/sync";
import { replicaStorage } from "@clientbridge/app-core";
import { PowerSyncDatabase, WASQLiteVFS } from "@powersync/web";
import { beforeSessionReplace, getUserId } from "./auth";
import { config } from "../config";

const { apiUrl, powersyncUrl } = config;

// navigator.vendor names the engine: every WebKit browser, iOS ones included, reports Apple
const vfs =
    replicaStorage(navigator.vendor) === "opfs"
        ? WASQLiteVFS.OPFSCoopSyncVFS
        : WASQLiteVFS.IDBBatchAtomicVFS;

export const replica = new ReplicaController(
    (dbFilename) =>
        new PowerSyncDatabase({
            schema: AppSchema,
            database: { dbFilename, vfs },
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
