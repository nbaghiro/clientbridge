import type { Session } from "@clientbridge/api-client";
import { AppSchema, createConnector, ReplicaController } from "@clientbridge/sync";
import { type ReplicaStorage, replicaStorage } from "@clientbridge/app-core";
import { type DBAdapter, PowerSyncDatabase, WASQLiteVFS, type WebDBAdapter } from "@powersync/web";
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

let opened: PowerSyncDatabase | null = null;

export const replica = new ReplicaController((dbFilename) => {
    opened = new PowerSyncDatabase({ schema: AppSchema, database: { dbFilename, vfs } });
    return opened;
});

beforeSessionReplace(() => replica.pause());

export async function connectPowerSync(api: Session) {
    const userId = getUserId();
    if (!userId) throw new Error("a valid account identity is required");
    vfs = VFS[await replicaStorageKind()];
    const db = await replica.activate(
        { userId, apiUrl, powersyncUrl },
        createConnector({ powersyncUrl, authFetch: api.forBusiness(null).authFetchFor(userId) }),
    );
    db.waitForFirstSync()
        .then(askToPersistOnce)
        .catch(() => undefined);
    return db;
}

const PERSIST_ASKED = "cb_persist_asked";

// without persistence the browser may evict the replica; Firefox prompts, so each profile is asked once
async function askToPersistOnce(): Promise<void> {
    if (!("storage" in navigator) || (await navigator.storage.persisted())) return;
    if (localStorage.getItem(PERSIST_ASKED) !== null) return;
    localStorage.setItem(PERSIST_ASKED, "1");
    await navigator.storage.persist();
}

function isWebAdapter(adapter: DBAdapter): adapter is WebDBAdapter {
    return "getConfiguration" in adapter;
}

interface StorageFacts {
    storage: ReplicaStorage;
    multiTabs: boolean;
    persisted: boolean;
    bytes: number;
    held: string[];
    pending: string[];
}

export async function storageFacts(): Promise<StorageFacts | null> {
    const db = opened;
    if (!db || !storage) return null;
    const [kind, persisted, size, locks] = await Promise.all([
        storage,
        navigator.storage.persisted(),
        db.get<{ bytes: number }>(
            "SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()",
        ),
        navigator.locks.query(),
    ]);
    const names = (list: LockInfo[] | undefined): string[] =>
        (list ?? []).map((lock) => lock.name ?? "");
    return {
        storage: kind,
        multiTabs: isWebAdapter(db.database) && db.database.getConfiguration().enableMultiTabs,
        persisted,
        bytes: size.bytes,
        held: names(locks.held),
        pending: names(locks.pending),
    };
}

export function signOut(): Promise<void> {
    return replica.discard();
}

export { powersyncUrl };
