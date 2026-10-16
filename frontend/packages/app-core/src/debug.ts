import { type TableCount, countsQuery } from "@clientbridge/sync";
import type { SyncStatus } from "@powersync/common";
import { usePowerSync } from "@powersync/react";
import { useCallback, useEffect, useState } from "react";

import { useSyncStatus } from "./domain/sync";

interface ClientState {
    status: SyncStatus;
    queue: {
        pending: number;
        rejected: number;
        awaiting: number;
        oldest: string | null;
        replicationDelayMs: string | null;
    } | null;
    tables: TableCount[];
    totalRows: number;
    refresh: () => void;
}

export function useClientState(pollMs = 1500): ClientState {
    const db = usePowerSync();
    const status = useSyncStatus();
    const [queue, setQueue] = useState<ClientState["queue"]>(null);
    const [tables, setTables] = useState<TableCount[]>([]);

    const refresh = useCallback((): void => {
        db.get<NonNullable<ClientState["queue"]>>(
            "SELECT count(*) AS pending, COALESCE(SUM(state = 'rejected'), 0) AS rejected, COALESCE(SUM(state = 'accepted'), 0) AS awaiting, MIN(created_at) AS oldest, (SELECT value FROM device_prefs WHERE id = 'sync.replicationDelayMs') AS replicationDelayMs FROM hours_outbox",
        )
            .then(setQueue)
            .catch(() => undefined);
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

    return {
        status,
        queue,
        tables,
        totalRows: tables.reduce((sum, t) => sum + t.rows, 0),
        refresh,
    };
}
