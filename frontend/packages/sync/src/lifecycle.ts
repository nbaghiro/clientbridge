import type { CommonPowerSyncDatabase } from "@powersync/common";

import type { ManagedConnector } from "./connector";

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
            await this.stopUploads?.();
            this.stopUploads = null;
            if (this.active?.identity !== key) {
                if (this.active) {
                    await this.active.db.disconnect();
                    await this.active.db.close();
                    this.active = null;
                }
                const db = this.open(filename(key));
                try {
                    await db.init();
                    const owner = await db.getOptional<{ value: string }>(
                        "SELECT value FROM device_prefs WHERE id = 'sync.identity'",
                    );
                    if (owner && owner.value !== key) throw new Error("replica ownership mismatch");
                    if (!owner) {
                        const rows = await db.getAll("SELECT id FROM businesses LIMIT 1");
                        const proposals = await db.getAll("SELECT id FROM hours_outbox LIMIT 1");
                        if (
                            rows.length ||
                            proposals.length ||
                            (await db.getUploadQueueStats()).count
                        )
                            throw new Error("unassigned replica requires recovery");
                        await db.execute(
                            "INSERT INTO device_prefs (id, value) VALUES ('sync.identity', ?)",
                            [key],
                        );
                    }
                    this.active = { db, identity: key };
                } catch (error) {
                    await db.close();
                    throw error;
                }
            }
            const db = this.active.db;
            if (generation !== this.generation) throw new Error("replica activation superseded");
            await db.disconnect();
            if (generation !== this.generation) throw new Error("replica activation superseded");
            await db.connect(connector);
            if (generation !== this.generation) {
                await db.disconnect();
                throw new Error("replica activation superseded");
            }
            this.stopUploads = connector.startUploads?.(db) ?? null;
            return db;
        });
    }

    pause(): Promise<void> {
        ++this.generation;
        return this.serialize(async () => {
            await this.stopUploads?.();
            this.stopUploads = null;
            await this.active?.db.disconnect();
        });
    }

    discard(): Promise<void> {
        ++this.generation;
        return this.serialize(async () => {
            await this.stopUploads?.();
            this.stopUploads = null;
            if (this.active) {
                await this.active.db.disconnectAndClear();
                await this.active.db.close();
                this.active = null;
            }
        });
    }
}
