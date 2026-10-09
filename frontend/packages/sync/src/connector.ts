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

        uploadData(): Promise<void> {
            return Promise.reject(
                new Error("Unexpected direct replica write; use the hours outbox"),
            );
        },
    };
}
