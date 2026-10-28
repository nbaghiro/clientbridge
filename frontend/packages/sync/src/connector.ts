// PowerSync downloads canonical data; the durable hours outbox owns offline writes.
import type {
    CommonPowerSyncDatabase,
    PowerSyncBackendConnector,
    PowerSyncCredentials,
} from "@powersync/common";

import { startHoursUploads } from "./hours";

interface ConnectorOptions {
    powersyncUrl: string;
    authFetch: (path: string, init?: RequestInit) => Promise<Response>;
}

export interface ManagedConnector extends PowerSyncBackendConnector {
    startUploads?: (db: CommonPowerSyncDatabase) => () => Promise<void>;
}

export function createConnector(opts: ConnectorOptions): ManagedConnector {
    return {
        startUploads: (db) => startHoursUploads(db, opts.authFetch),
        async fetchCredentials(): Promise<PowerSyncCredentials> {
            const res = await opts.authFetch("/sync/token");
            if (!res.ok) throw new Error(`sync token failed: ${res.status}`);
            const { token } = (await res.json()) as { token: string };
            return { endpoint: opts.powersyncUrl, token };
        },

        uploadData: discardDirectWrites,
    };
}

/** Records and drops a stray write to a synced table, since PowerSync applies no checkpoint while one waits. */
export async function discardDirectWrites(db: CommonPowerSyncDatabase): Promise<void> {
    for (let batch = await db.getCrudBatch(100); batch; batch = await db.getCrudBatch(100)) {
        const dropped = batch.crud.map((entry) => `${entry.op} ${entry.table} ${entry.id}`);
        await db.execute(
            "INSERT OR REPLACE INTO device_prefs (id, value, updated_at) VALUES ('sync.droppedWrites', ?, ?)",
            [JSON.stringify(dropped), new Date().toISOString()],
        );
        await batch.complete();
    }
}
