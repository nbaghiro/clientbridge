import type { Session } from "@clientbridge/api-client";
import { AppSchema, createConnector, ReplicaController } from "@clientbridge/sync";
import { type ReplicaStorage, replicaStorage } from "@clientbridge/app-core";
import { PowerSyncDatabase, WASQLiteVFS } from "@powersync/web";
import { beforeSessionReplace, getUserId } from "./auth";
import { config } from "../config";

const { apiUrl, powersyncUrl } = config;

const VFS = {
    indexeddb: WASQLiteVFS.IDBBatchAtomicVFS,
    opfs: WASQLiteVFS.OPFSCoopSyncVFS,
} satisfies Record<ReplicaStorage, WASQLiteVFS>;

function opfsSyncAccess(): Promise<boolean> {
    return new Promise((resolve) => {
        const worker = new Worker(new URL("./opfsProbe.ts", import.meta.url), { type: "module" });
        const answer = (granted: boolean): void => {
            worker.terminate();
            resolve(granted);
        };
        worker.onmessage = (event: MessageEvent<unknown>) => {
            answer(event.data === true);
        };
        worker.onerror = () => {
            answer(false);
        };
    });
}

let storage: Promise<ReplicaStorage> | null = null;
let vfs: WASQLiteVFS = VFS.indexeddb;

/** Where this browser keeps the replica, decided once per page: navigator.vendor names the engine. */
function replicaStorageKind(): Promise<ReplicaStorage> {
    storage ??= replicaStorage(navigator.vendor, opfsSyncAccess);
    return storage;
}

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
    vfs = VFS[await replicaStorageKind()];
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
