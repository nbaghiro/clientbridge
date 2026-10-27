import type { CommonPowerSyncDatabase, SyncStreamSubscription } from "@powersync/common";

import type { ManagedConnector } from "./connector";
import { subscribeHistory, maintainHistory } from "./history";

interface ReplicaIdentity {
    userId: string;
    apiUrl: string;
    powersyncUrl: string;
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

export class ReplicaController {
    private tail: Promise<void> = Promise.resolve();
    private generation = 0;
    private stopUploads: (() => Promise<void>) | null = null;
    private history: SyncStreamSubscription[] = [];
    private stopHistory: (() => void) | null = null;
    private active: { db: CommonPowerSyncDatabase; identity: string; filename: string } | null =
        null;

    constructor(
        private readonly open: (filename: string) => CommonPowerSyncDatabase,
        private readonly remove?: (filename: string) => Promise<void>,
    ) {}

    private serialize<T>(action: () => Promise<T>): Promise<T> {
        const next = this.tail.then(action);
        this.tail = next.then(
            () => undefined,
            () => undefined,
        );
        return next;
    }

    private async stop(): Promise<void> {
        this.stopHistory?.();
        this.stopHistory = null;
        await this.stopUploads?.();
        this.stopUploads = null;
        for (const subscription of this.history) subscription.unsubscribe();
        this.history = [];
    }

    private async release(): Promise<void> {
        if (!this.active) return;
        await this.active.db.disconnect();
        await this.active.db.close();
        this.active = null;
    }

    activate(
        identity: ReplicaIdentity,
        connector: ManagedConnector,
    ): Promise<CommonPowerSyncDatabase> {
        const generation = ++this.generation;
        const key = JSON.stringify([
            identity.apiUrl.replace(/\/$/, ""),
            identity.powersyncUrl.replace(/\/$/, ""),
            identity.userId,
        ]);
        return this.serialize(async () => {
            if (generation !== this.generation) throw new Error("replica activation superseded");
            this.stopHistory?.();
            this.stopHistory = null;
            await this.stopUploads?.();
            this.stopUploads = null;
            if (this.active?.identity !== key) {
                if (this.active) {
                    for (const subscription of this.history) subscription.unsubscribe();
                    this.history = [];
                    await this.release();
                }
                const name = filename(key);
                const db = this.open(name);
                try {
                    await db.init();
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
                    this.active = { db, identity: key, filename: name };
                } catch (error) {
                    await db.close();
                    throw error;
                }
            }
            const db = this.active.db;
            if (generation !== this.generation) throw new Error("replica activation superseded");
            await db.disconnect();
            if (generation !== this.generation) throw new Error("replica activation superseded");
            const previous = this.history;
            this.history = await subscribeHistory(db);
            for (const subscription of previous) subscription.unsubscribe();
            await db.connect(connector);
            if (generation !== this.generation) {
                await db.disconnect();
                throw new Error("replica activation superseded");
            }
            this.stopUploads = connector.startUploads?.(db) ?? null;
            for (const subscription of this.history) subscription.unsubscribe();
            this.history = [];
            this.stopHistory = maintainHistory(db);
            // without table statistics SQLite prefers the business_id index, scanning a whole business per row
            db.waitForFirstSync()
                .then(() => db.execute("PRAGMA optimize=0x10002"))
                .catch(() => undefined);
            return db;
        });
    }

    pause(): Promise<void> {
        ++this.generation;
        return this.serialize(async () => {
            this.stopHistory?.();
            this.stopHistory = null;
            await this.stopUploads?.();
            this.stopUploads = null;
            await this.active?.db.disconnect();
        });
    }

    /** Disconnects and closes the replica but keeps its file, so the next activate reopens it. */
    close(): Promise<void> {
        ++this.generation;
        return this.serialize(async () => {
            await this.stop();
            await this.release();
        });
    }

    discard(): Promise<void> {
        ++this.generation;
        return this.serialize(async () => {
            await this.stop();
            if (!this.active) return;
            const { db, filename: name } = this.active;
            await db.disconnectAndClear();
            await db.close();
            this.active = null;
            await this.remove?.(name);
        });
    }
}
