// PowerSync backend connector — the bridge to our FastAPI backend.
//  - fetchCredentials(): exchange the app session for a PowerSync token (GET /sync/token)
//  - uploadData():       POST the local write queue to the server-authoritative endpoint (/sync/upload)
import type {
    AbstractPowerSyncDatabase,
    CrudEntry,
    PowerSyncBackendConnector,
    PowerSyncCredentials,
} from "@powersync/common";

export interface ConnectorOptions {
    /** FastAPI base URL, e.g. http://localhost:8701 */
    backendUrl: string;
    /** PowerSync service URL, e.g. http://localhost:8704 */
    powersyncUrl: string;
    /** Returns the current app JWT (your auth session). */
    getToken: () => Promise<string>;
}

export function createConnector(opts: ConnectorOptions): PowerSyncBackendConnector {
    // Only send Authorization when we actually have a token — a bare "Bearer" confuses the server,
    // and in dev the backend falls back to the dev user when no auth header is present.
    const auth = async (): Promise<Record<string, string>> => {
        const token = await opts.getToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
    };

    return {
        async fetchCredentials(): Promise<PowerSyncCredentials> {
            const res = await fetch(`${opts.backendUrl}/sync/token`, { headers: await auth() });
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

            const res = await fetch(`${opts.backendUrl}/sync/upload`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(await auth()) },
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
