import { type TableCount, countsQuery } from "@clientbridge/sync";
import { usePowerSync, useStatus } from "@powersync/react";
import { useCallback, useEffect, useState } from "react";

export interface ClientState {
    status: ReturnType<typeof useStatus>;
    tables: TableCount[];
    totalRows: number;
    refresh: () => Promise<void>;
}

/** Live view of what this device holds: connection status + per-table row counts from local SQLite. */
export function useClientState(pollMs = 1500): ClientState {
    const db = usePowerSync();
    const status = useStatus();
    const [tables, setTables] = useState<TableCount[]>([]);

    const refresh = useCallback(async (): Promise<void> => {
        try {
            const rows = await db.getAll<TableCount>(countsQuery());
            setTables(rows.filter((r) => r.rows > 0).sort((a, b) => b.rows - a.rows));
        } catch {
            // Before the first sync the tables may not exist yet — ignore.
        }
    }, [db]);

    useEffect(() => {
        void refresh();
        const id = setInterval(() => void refresh(), pollMs);
        return () => {
            clearInterval(id);
        };
    }, [refresh, pollMs, status.lastSyncedAt]);

    return { status, tables, totalRows: tables.reduce((sum, t) => sum + t.rows, 0), refresh };
}
