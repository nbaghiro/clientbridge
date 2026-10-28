import type { Session } from "@clientbridge/api-client";
import {
    AppSchema,
    createConnector,
    ReplicaController,
    replicaFilename,
    selectBusinessPerTab,
} from "@clientbridge/sync";
import { removeReplicaFiles } from "@clientbridge/sync/files";
import { boundedOpen, type ReplicaStorage, replicaStorage } from "@clientbridge/app-core";
import { type DBAdapter, PowerSyncDatabase, WASQLiteVFS, type WebDBAdapter } from "@powersync/web";
import { beforeSessionReplace, getUserId } from "./auth";
import { opfsSyncAccess } from "./storage";
import { config } from "../config";

const { powersyncUrl } = config;

const VFS = {
    indexeddb: WASQLiteVFS.IDBBatchAtomicVFS,
    opfs: WASQLiteVFS.OPFSCoopSyncVFS,
} satisfies Record<ReplicaStorage, WASQLiteVFS>;

let storage: Promise<ReplicaStorage> | null = null;
let vfs: WASQLiteVFS = VFS.indexeddb;

/** Where this browser keeps the replica, decided once per page: navigator.vendor names the engine. */
function replicaStorageKind(): Promise<ReplicaStorage> {
    // a probe that didn't answer is asked again on the next try
    storage ??= replicaStorage(navigator.vendor, opfsSyncAccess).catch((error: unknown) => {
        storage = null;
        throw error;
    });
    return storage;
}

// the page's origin, not the served URLs, so a new API or sync host keeps the file and its unsent edits
function replicaIdentity(): { userId: string; scope: string } | null {
    const userId = getUserId();
    return userId ? { userId, scope: location.origin } : null;
}

const TAB = "cb_tab";

// kept for the tab's life, reloads included, so switching business in one tab leaves the others
function tabKey(): string {
    try {
        const kept = sessionStorage.getItem(TAB);
        if (kept) return kept;
        const key = crypto.randomUUID();
        sessionStorage.setItem(TAB, key);
        return key;
    } catch {
        return crypto.randomUUID();
    }
}

selectBusinessPerTab(tabKey());

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
    if ((await replicaStorageKind().catch(() => null)) !== "opfs") {
        keepTrash(trash().filter((listed) => listed !== name));
        return;
    }
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

export const replica = new ReplicaController(
    (dbFilename) => {
        opened = new PowerSyncDatabase({ schema: AppSchema, database: { dbFilename, vfs } });
        return opened;
    },
    {
        list: (name) => {
            keepTrash([...trash(), name]);
        },
        remove: removeOnSignOut,
    },
);

beforeSessionReplace(() => replica.pause());

export async function connectPowerSync(api: Session) {
    const identity = replicaIdentity();
    if (!identity) throw new Error("a valid account identity is required");
    kind = await replicaStorageKind();
    vfs = VFS[kind];
    if (kind === "opfs") await sweep(replicaFilename(identity)).catch(() => undefined);
    const db = await boundedOpen(
        replica.activate(
            identity,
            createConnector({
                powersyncUrl,
                authFetch: api.forBusiness(null).authFetchFor(identity.userId),
            }),
        ),
        () => {
            replica.abandon();
        },
    );
    db.waitForFirstSync()
        .then(askToPersist)
        .catch(() => undefined);
    return db;
}

function settled(work: Promise<void>, ms: number): Promise<void> {
    return Promise.race([
        work.catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, ms)),
    ]);
}

let restored: () => void = () => undefined;
let staying: ReturnType<typeof setTimeout> | undefined;

/** Every full-page navigation goes here: WebKit keeps a script-navigated page's OPFS locks (bug 316904). */
export async function leave(url: string, how: "assign" | "replace" = "assign"): Promise<void> {
    if (kind !== "opfs") {
        location[how](url);
        return;
    }
    await settled(replica.close(), 2_000);
    location[how](url);
    // a navigation that never happens (stopped, or blocked) leaves this page running, so it reopens
    clearTimeout(staying);
    staying = setTimeout(() => {
        restored();
    }, 8_000);
}

export function onPageRestored(handler: () => void): void {
    restored = handler;
}

addEventListener("pagehide", () => {
    clearTimeout(staying);
    if (kind === "opfs") replica.close().catch(() => undefined);
});

// a page back from the back-forward cache had its replica closed on pagehide
addEventListener("pageshow", (event) => {
    if (event.persisted && kind === "opfs") restored();
});

const PERSIST_ASKED = "cb_persist_asked";

// unpersisted storage can be evicted; Firefox prompts, so only it is asked just once per profile
async function askToPersist(): Promise<void> {
    if (!("storage" in navigator) || (await navigator.storage.persisted())) return;
    if (/\bFirefox\//.test(navigator.userAgent)) {
        if (localStorage.getItem(PERSIST_ASKED) !== null) return;
        localStorage.setItem(PERSIST_ASKED, "1");
    }
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

/** Clears and deletes this account's replica; listed for deletion at once, so a later start retries it. */
export function signOut(): Promise<void> {
    return replica.discard(replicaIdentity() ?? undefined);
}

export { powersyncUrl };
