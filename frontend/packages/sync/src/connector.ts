// PowerSync backend connector — bridges to our FastAPI backend through an authenticated fetch that
// transparently refreshes the access token (and signs out when the session is unrecoverable).
//  - fetchCredentials(): exchange the app session for a PowerSync token (GET /sync/token)
//  - uploadData():       POST the local write queue to the server-authoritative endpoint (/sync/upload)
import type {
    AbstractPowerSyncDatabase,
    CrudEntry,
    PowerSyncBackendConnector,
    PowerSyncCredentials,
} from "@powersync/common";

export interface ConnectorOptions {
    /** PowerSync service URL, e.g. http://localhost:8704 */
    powersyncUrl: string;
    /** Authenticated fetch against the FastAPI backend (handles auth header + refresh + sign-out). */
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

        async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
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
