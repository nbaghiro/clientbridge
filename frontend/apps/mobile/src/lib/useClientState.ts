import { countsQuery, type TableCount } from "@clientbridge/sync";
import { usePowerSync, useStatus } from "@powersync/react";
import { useEffect, useState } from "react";

/** Live view of what this device holds: connection status + per-table row counts from local SQLite. */
export function useClientState(pollMs = 1500): {
    status: ReturnType<typeof useStatus>;
    tables: TableCount[];
    totalRows: number;
} {
    const db = usePowerSync();
    const status = useStatus();
    const [tables, setTables] = useState<TableCount[]>([]);

    useEffect(() => {
        let active = true;
        const run = async (): Promise<void> => {
            try {
                const rows = await db.getAll<TableCount>(countsQuery());
                if (active) {
                    setTables(rows.filter((r) => r.rows > 0).sort((a, b) => b.rows - a.rows));
                }
            } catch {
                // Before the first sync the tables may not exist yet — ignore.
            }
        };
        void run();
        const id = setInterval(() => void run(), pollMs);
        return () => {
            active = false;
            clearInterval(id);
        };
    }, [db, pollMs, status.lastSyncedAt]);

    return { status, tables, totalRows: tables.reduce((sum, t) => sum + t.rows, 0) };
}
