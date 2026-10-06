// PowerSync connector: fetchCredentials() calls /sync/token and uploadData() posts to /sync/upload.
import type {
    CommonPowerSyncDatabase,
    CrudEntry,
    PowerSyncBackendConnector,
    PowerSyncCredentials,
} from "@powersync/common";

interface ConnectorOptions {
    powersyncUrl: string;
    authFetch: (path: string, init?: RequestInit) => Promise<Response>;
}

export function createConnector(opts: ConnectorOptions): PowerSyncBackendConnector {
    return {
        async fetchCredentials(): Promise<PowerSyncCredentials> {
            const res = await opts.authFetch("/sync/token");
            if (!res.ok) throw new Error(`sync token failed: ${res.status}`);
            const { token } = (await res.json()) as { token: string };
            return { endpoint: opts.powersyncUrl, token };
        },

        async uploadData(database: CommonPowerSyncDatabase): Promise<void> {
            const tx = await database.getNextCrudTransaction();
            if (!tx) return;

            const ops = tx.crud.map((e: CrudEntry) => ({
                op: e.op, // PUT | PATCH | DELETE
                type: e.table,
                id: e.id,
                data: e.opData,
            }));

            const res = await opts.authFetch("/sync/upload", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ops }),
            });
            if (!res.ok) {
                // Throwing leaves the transaction queued for retry on the next sync.
                throw new Error(`sync upload failed: ${res.status}`);
            }
            await tx.complete();
        },
    };
}
