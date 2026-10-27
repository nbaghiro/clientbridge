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
    private active: { db: CommonPowerSyncDatabase; identity: string } | null = null;

    constructor(private readonly open: (filename: string) => CommonPowerSyncDatabase) {}

    private serialize<T>(action: () => Promise<T>): Promise<T> {
        const next = this.tail.then(action);
        this.tail = next.then(
            () => undefined,
            () => undefined,
        );
        return next;
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
            console.error("DBGACT before 1", performance.now().toFixed(0), 'await this.stopUploads?.();');
            await this.stopUploads?.();
            console.error("DBGACT after 1", performance.now().toFixed(0));
            this.stopUploads = null;
            if (this.active?.identity !== key) {
                if (this.active) {
                    for (const subscription of this.history) subscription.unsubscribe();
                    this.history = [];
                    console.error("DBGACT before 2", performance.now().toFixed(0), 'await this.active.db.disconnect();');
                    await this.active.db.disconnect();
                    console.error("DBGACT after 2", performance.now().toFixed(0));
                    console.error("DBGACT before 3", performance.now().toFixed(0), 'await this.active.db.close();');
                    await this.active.db.close();
                    console.error("DBGACT after 3", performance.now().toFixed(0));
                    this.active = null;
                }
                const db = this.open(filename(key));
                try {
                    console.error("DBGACT before 4", performance.now().toFixed(0), 'await db.init();');
                    await db.init();
                    console.error("DBGACT after 4", performance.now().toFixed(0));
                    // Other tabs open the same replica, so the claim is one write transaction.
                    console.error("DBGACT before 5", performance.now().toFixed(0), 'const owner = await db.writeTransaction(async (tx)');
                    const owner = await db.writeTransaction(async (tx) => {
                        console.error("DBGACT before 6", performance.now().toFixed(0), 'const claimed = await tx.getOptional<{ value: stri');
                        const claimed = await tx.getOptional<{ value: string }>(
                            "SELECT value FROM device_prefs WHERE id = 'sync.identity'",
                        );
                        if (claimed) return claimed.value;
                        console.error("DBGACT before 7", performance.now().toFixed(0), 'const rows = await tx.getAll("SELECT id FROM busin');
                        const rows = await tx.getAll("SELECT id FROM businesses LIMIT 1");
                        console.error("DBGACT after 7", performance.now().toFixed(0));
                        console.error("DBGACT before 8", performance.now().toFixed(0), 'const proposals = await tx.getAll("SELECT id FROM ');
                        const proposals = await tx.getAll("SELECT id FROM hours_outbox LIMIT 1");
                        console.error("DBGACT after 8", performance.now().toFixed(0));
                        if (rows.length || proposals.length)
                            throw new Error("unassigned replica requires recovery");
                        console.error("DBGACT before 9", performance.now().toFixed(0), 'await tx.execute(');
                        await tx.execute(
                            "INSERT INTO device_prefs (id, value) VALUES ('sync.identity', ?)",
                            [key],
                        );
                        return key;
                    });
                    if (owner !== key) throw new Error("replica ownership mismatch");
                    this.active = { db, identity: key };
                } catch (error) {
                    console.error("DBGACT before 10", performance.now().toFixed(0), 'await db.close();');
                    await db.close();
                    console.error("DBGACT after 10", performance.now().toFixed(0));
                    throw error;
                }
            }
            const db = this.active.db;
            if (generation !== this.generation) throw new Error("replica activation superseded");
            console.error("DBGACT before 11", performance.now().toFixed(0), 'await db.disconnect();');
            await db.disconnect();
            console.error("DBGACT after 11", performance.now().toFixed(0));
            if (generation !== this.generation) throw new Error("replica activation superseded");
            const previous = this.history;
            console.error("DBGACT before 12", performance.now().toFixed(0), 'this.history = await subscribeHistory(db);');
            this.history = await subscribeHistory(db);
            console.error("DBGACT after 12", performance.now().toFixed(0));
            for (const subscription of previous) subscription.unsubscribe();
            console.error("DBGACT before 13", performance.now().toFixed(0), 'await db.connect(connector);');
            await db.connect(connector);
            console.error("DBGACT after 13", performance.now().toFixed(0));
            if (generation !== this.generation) {
                console.error("DBGACT before 14", performance.now().toFixed(0), 'await db.disconnect();');
                await db.disconnect();
                console.error("DBGACT after 14", performance.now().toFixed(0));
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
        console.error("DBGACT pause requested", performance.now().toFixed(0));
        ++this.generation;
        return this.serialize(async () => {
            this.stopHistory?.();
            this.stopHistory = null;
            await this.stopUploads?.();
            this.stopUploads = null;
            await this.active?.db.disconnect();
        });
    }

    discard(): Promise<void> {
        ++this.generation;
        return this.serialize(async () => {
            this.stopHistory?.();
            this.stopHistory = null;
            await this.stopUploads?.();
            this.stopUploads = null;
            for (const subscription of this.history) subscription.unsubscribe();
            this.history = [];
            if (this.active) {
                await this.active.db.disconnectAndClear();
                await this.active.db.close();
                this.active = null;
            }
        });
    }
}
