import type { CommonPowerSyncDatabase, SyncStreamSubscription } from "@powersync/common";

import type { ManagedConnector } from "./connector";
import { subscribeHistory, maintainHistory } from "./history";

/** The account a replica belongs to; `scope` names its deployment (the web origin, or mobile's API). */
interface ReplicaIdentity {
    userId: string;
    scope: string;
}

function identityKey(identity: ReplicaIdentity): string {
    return JSON.stringify([identity.scope.replace(/\/$/, ""), identity.userId]);
}

/** The user a claimed replica belongs to, read from its `sync.identity` row. */
export function replicaOwner(claim: string): string | null {
    const parts: unknown = JSON.parse(claim);
    const owner: unknown = Array.isArray(parts) ? parts.at(-1) : null;
    return typeof owner === "string" ? owner : null;
}

export function replicaFilename(identity: ReplicaIdentity): string {
    return filename(identityKey(identity));
}

function filename(identity: string): string {
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (const char of identity) {
        first = Math.imul(first ^ char.charCodeAt(0), 0x01000193);
        second = Math.imul(second ^ char.charCodeAt(0), 0x85ebca6b);
    }
    return `clientbridge-${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}.db`;
}

/** How a platform deletes a signed-out account's file; mobile keeps it. */
interface ReplicaFiles {
    /** Records the file for deletion before anything can fail, so a later start retries it. */
    list: (filename: string) => void;
    remove: (filename: string) => Promise<void>;
}

/** How web tabs that share one sync worker hand its connection on when one of them stops syncing. */
export interface ReplicaTabs {
    shared: (db: CommonPowerSyncDatabase) => boolean;
    /** Calls `reconnect` in one syncing tab after another tab hands off; the result stops listening. */
    join: (filename: string, reconnect: () => Promise<void>) => () => void;
    /** Runs `leave`, then has a syncing tab reconnect, also when this page dies before `leave` settles. */
    handOff: (filename: string, leave: () => Promise<void>) => Promise<void>;
}

interface Active {
    db: CommonPowerSyncDatabase;
    identity: string;
    filename: string;
    shared: boolean;
    connector: ManagedConnector | null;
    stopListening: (() => void) | null;
}

// one queue of replica work; abandon() starts a fresh one when an open hangs
interface Queue {
    tail: Promise<void>;
    abandoned: boolean;
    stopUploads: (() => Promise<void>) | null;
    history: SyncStreamSubscription[];
    stopHistory: (() => void) | null;
    active: Active | null;
}

function emptyQueue(): Queue {
    return {
        tail: Promise.resolve(),
        abandoned: false,
        stopUploads: null,
        history: [],
        stopHistory: null,
        active: null,
    };
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

// read through a call, since an abandon can land during any await
function abandoned(queue: Queue): boolean {
    return queue.abandoned;
}

function superseded(): Error {
    return new Error("replica activation superseded");
}

export class ReplicaController {
    private queue = emptyQueue();
    private generation = 0;

    constructor(
        private readonly open: (filename: string) => CommonPowerSyncDatabase,
        private readonly files?: ReplicaFiles,
        private readonly tabs?: ReplicaTabs,
    ) {}

    private serialize<T>(action: (queue: Queue) => Promise<T>): Promise<T> {
        const queue = this.queue;
        const next = queue.tail.then(() => action(queue));
        queue.tail = next.then(
            () => undefined,
            () => undefined,
        );
        return next;
    }

    private async stop(queue: Queue): Promise<void> {
        queue.stopHistory?.();
        queue.stopHistory = null;
        await queue.stopUploads?.();
        queue.stopUploads = null;
        for (const subscription of queue.history) subscription.unsubscribe();
        queue.history = [];
    }

    // a shared worker's stream may be writing through this tab's connection, so it stops before the close
    private async detach(active: Active, close: boolean): Promise<void> {
        const { db } = active;
        const leave = async () => {
            await db.disconnect();
            if (close) await db.close();
        };
        active.stopListening?.();
        active.stopListening = null;
        if (active.shared && this.tabs) await this.tabs.handOff(active.filename, leave);
        else await leave();
    }

    private listen(queue: Queue, active: Active): void {
        if (!active.shared || !this.tabs || active.stopListening) return;
        active.stopListening = this.tabs.join(active.filename, async () => {
            if (queue.active !== active || !active.stopListening || !active.connector) return;
            await active.db.connect(active.connector).catch(() => undefined);
        });
    }

    private async release(queue: Queue): Promise<void> {
        if (!queue.active) return;
        await this.detach(queue.active, true);
        queue.active = null;
    }

    activate(
        identity: ReplicaIdentity,
        connector: ManagedConnector,
    ): Promise<CommonPowerSyncDatabase> {
        const generation = ++this.generation;
        const key = identityKey(identity);
        return this.serialize(async (queue) => {
            if (generation !== this.generation) throw superseded();
            queue.stopHistory?.();
            queue.stopHistory = null;
            await queue.stopUploads?.();
            queue.stopUploads = null;
            if (queue.active?.identity !== key) {
                if (queue.active) {
                    for (const subscription of queue.history) subscription.unsubscribe();
                    queue.history = [];
                    await this.release(queue);
                }
                const name = filename(key);
                const db = this.open(name);
                try {
                    await db.init();
                    if (abandoned(queue)) throw superseded();
                    // Other tabs open the same replica, so the claim is one write transaction.
                    const owner = await db.writeTransaction(async (tx) => {
                        const claimed = await tx.getOptional<{ value: string }>(
                            "SELECT value FROM device_prefs WHERE id = 'sync.identity'",
                        );
                        if (claimed) return claimed.value;
                        const rows = await tx.getAll("SELECT id FROM businesses LIMIT 1");
                        const proposals = await tx.getAll("SELECT id FROM hours_outbox LIMIT 1");
                        if (rows.length || proposals.length)
                            throw new Error("unassigned replica requires recovery");
                        await tx.execute(
                            "INSERT INTO device_prefs (id, value) VALUES ('sync.identity', ?)",
                            [key],
                        );
                        return key;
                    });
                    if (owner !== key) throw new Error("replica ownership mismatch");
                    if (abandoned(queue)) throw superseded();
                    queue.active = {
                        db,
                        identity: key,
                        filename: name,
                        shared: this.tabs?.shared(db) ?? false,
                        connector: null,
                        stopListening: null,
                    };
                } catch (error) {
                    await db.close();
                    throw error;
                }
            }
            const active = queue.active;
            const db = active.db;
            if (generation !== this.generation) throw superseded();
            await db.disconnect();
            if (generation !== this.generation) throw superseded();
            const previous = queue.history;
            // held until stop(), so the stream request carries them from its start
            queue.history = await subscribeHistory(db);
            for (const subscription of previous) subscription.unsubscribe();
            active.connector = connector;
            this.listen(queue, active);
            // with multi-tab sync off, a second tab's connect() waits for the first tab's sync lock
            db.connect(connector).catch(() => undefined);
            queue.stopUploads = connector.startUploads?.(db) ?? null;
            queue.stopHistory = maintainHistory(db);
            // without table statistics SQLite prefers the business_id index, scanning a whole business per row
            db.waitForFirstSync()
                .then(() => db.execute("PRAGMA optimize=0x10002"))
                .catch(() => undefined);
            return db;
        });
    }

    pause(): Promise<void> {
        ++this.generation;
        return this.serialize(async (queue) => {
            queue.stopHistory?.();
            queue.stopHistory = null;
            await queue.stopUploads?.();
            queue.stopUploads = null;
            if (queue.active) await this.detach(queue.active, false);
        });
    }

    /** Disconnects and closes the replica but keeps its file, so the next activate reopens it. */
    close(): Promise<void> {
        ++this.generation;
        return this.serialize(async (queue) => {
            await this.stop(queue);
            await this.release(queue);
        });
    }

    /** Gives up a hung open: later calls run on a fresh queue, and the open closes its replica if it finishes. */
    abandon(): void {
        ++this.generation;
        const queue = this.queue;
        this.queue = emptyQueue();
        queue.abandoned = true;
        queue.stopHistory?.();
        queue.stopUploads?.().catch(() => undefined);
        for (const subscription of queue.history) subscription.unsubscribe();
        queue.active?.stopListening?.();
        queue.active?.db.close().catch(() => undefined);
    }

    /** Clears the replica and deletes its file; `identity` names the file when none is open. */
    discard(identity?: ReplicaIdentity): Promise<void> {
        ++this.generation;
        const names = new Set<string>();
        if (identity) names.add(filename(identityKey(identity)));
        if (this.queue.active) names.add(this.queue.active.filename);
        for (const name of names) this.files?.list(name);
        return this.serialize(async (queue) => {
            await this.stop(queue);
            const active = queue.active;
            let failure: Error | null = null;
            if (active) {
                if (!names.has(active.filename)) {
                    names.add(active.filename);
                    this.files?.list(active.filename);
                }
                active.stopListening?.();
                try {
                    // sign-out ends the session in every tab, so no other tab takes the sync over
                    await active.db.disconnectAndClear();
                } catch (error) {
                    failure = asError(error);
                }
                await active.db.close().catch((error: unknown) => {
                    failure ??= asError(error);
                });
                queue.active = null;
            }
            for (const name of names) await this.files?.remove(name);
            // where the file is deleted it stays listed until it's gone; elsewhere clearing is the only wipe
            if (failure !== null && !this.files) throw failure;
        });
    }
}
