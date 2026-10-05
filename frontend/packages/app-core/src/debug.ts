import { type TableCount, countsQuery } from "@clientbridge/sync";
import { usePowerSync, useStatus } from "@powersync/react";
import { useCallback, useEffect, useState } from "react";

export interface ClientState {
    status: ReturnType<typeof useStatus>;
    tables: TableCount[];
    totalRows: number;
    refresh: () => void;
}

/** Live view of what this device holds: connection status + per-table row counts from local SQLite. */
export function useClientState(pollMs = 1500): ClientState {
    const db = usePowerSync();
    const status = useStatus();
    const [tables, setTables] = useState<TableCount[]>([]);

    const refresh = useCallback((): void => {
        db.getAll<TableCount>(countsQuery())
            .then((rows) => {
                setTables(rows.filter((r) => r.rows > 0).sort((a, b) => b.rows - a.rows));
            })
            .catch(() => undefined); // before the first sync the tables may not exist yet — ignore
    }, [db]);

    useEffect(() => {
        refresh();
        const id = setInterval(refresh, pollMs);
        return () => {
            clearInterval(id);
        };
    }, [refresh, pollMs, status.lastSyncedAt]);

    return { status, tables, totalRows: tables.reduce((sum, t) => sum + t.rows, 0), refresh };
}
