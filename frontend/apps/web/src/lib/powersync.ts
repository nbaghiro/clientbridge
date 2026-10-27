import type { Session } from "@clientbridge/api-client";
import { AppSchema, createConnector, ReplicaController, replicaFilename } from "@clientbridge/sync";
import { removeReplicaFiles } from "@clientbridge/sync/files";
import { boundedOpen, type ReplicaStorage, replicaStorage } from "@clientbridge/app-core";
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

let kind: ReplicaStorage | null = null;
let opened: PowerSyncDatabase | null = null;

const TRASH = "cb_replica_trash";

function trash(): string[] {
    try {
        const listed: unknown = JSON.parse(localStorage.getItem(TRASH) ?? "[]");
        return Array.isArray(listed)
            ? listed.filter((name): name is string => typeof name === "string")
            : [];
    } catch {
        return [];
    }
}

function keepTrash(names: string[]): void {
    if (names.length) localStorage.setItem(TRASH, JSON.stringify([...new Set(names)]));
    else localStorage.removeItem(TRASH);
}

// resolves true once the name is off the list, including when its account reopened it meanwhile
async function removeListed(name: string): Promise<boolean> {
    if (!trash().includes(name)) return true;
    if (!(await removeReplicaFiles(name).catch(() => false))) return false;
    keepTrash(trash().filter((listed) => listed !== name));
    return true;
}

// another tab may still hold the file, so a sign-out keeps trying briefly and the next start tries again
async function removeOnSignOut(name: string): Promise<void> {
    if (kind !== "opfs") return;
    keepTrash([...trash(), name]);
    const deadline = Date.now() + 5_000;
    while (!(await removeListed(name)) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 500));
}

const PROBE = ".clientbridge-opfs-probe";

async function sweepProbeFiles(): Promise<void> {
    const root = await navigator.storage.getDirectory();
    await navigator.locks.request(PROBE, { ifAvailable: true }, async (lock) => {
        if (!lock) return;
        const names: string[] = [];
        for await (const name of root.keys()) if (name.startsWith(PROBE)) names.push(name);
        for (const name of names) await root.removeEntry(name).catch(() => undefined);
    });
}

// the opening account's own name comes off first, so its new edits are never swept
async function sweep(own: string | null): Promise<void> {
    keepTrash(trash().filter((name) => name !== own));
    for (const name of trash()) await removeListed(name);
    await sweepProbeFiles();
}

/** A start with no account to open retries every listed replica. */
export async function sweepSignedOut(): Promise<void> {
    if ((await replicaStorageKind()) === "opfs") await sweep(null);
}

export const replica = new ReplicaController((dbFilename) => {
    opened = new PowerSyncDatabase({ schema: AppSchema, database: { dbFilename, vfs } });
    return opened;
}, removeOnSignOut);

beforeSessionReplace(() => replica.pause());

export async function connectPowerSync(api: Session) {
    const userId = getUserId();
    if (!userId) throw new Error("a valid account identity is required");
    kind = await replicaStorageKind();
    vfs = VFS[kind];
    const identity = { userId, apiUrl, powersyncUrl };
    if (kind === "opfs") await sweep(replicaFilename(identity)).catch(() => undefined);
    const db = await boundedOpen(
        replica.activate(
            identity,
            createConnector({
                powersyncUrl,
                authFetch: api.forBusiness(null).authFetchFor(userId),
            }),
        ),
    );
    db.waitForFirstSync()
        .then(askToPersistOnce)
        .catch(() => undefined);
    return db;
}

function settled(work: Promise<void>, ms: number): Promise<void> {
    return Promise.race([
        work.catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, ms)),
    ]);
}

/** Every full-page navigation goes here: WebKit keeps a script-navigated page's OPFS locks (bug 316904). */
export async function leave(url: string, how: "assign" | "replace" = "assign"): Promise<void> {
    if (kind === "opfs") await settled(replica.close(), 2_000);
    location[how](url);
}

let restored: () => void = () => undefined;

export function onPageRestored(handler: () => void): void {
    restored = handler;
}

addEventListener("pagehide", () => {
    if (kind === "opfs") replica.close().catch(() => undefined);
});

// a page back from the back-forward cache had its replica closed on pagehide
addEventListener("pageshow", (event) => {
    if (event.persisted && kind === "opfs") restored();
});

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
