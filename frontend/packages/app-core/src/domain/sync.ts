import { usePowerSync, useQuery, useStatus } from "@powersync/react";
import { useCallback, useEffect, useState } from "react";

import { formatTime } from "../datetime";
import { type Load, type LoadSource, useLoad } from "../hooks";
import { strings } from "../strings";

export const DEVICE_PREF_SQL = "SELECT value FROM device_prefs WHERE id = ?";

/** A small value kept on this device only (recent searches, read marks); null until set. */
export function useDevicePref(key: string): [string | null, (value: string | null) => void] {
    const db = usePowerSync();
    const value = useQuery<{ value: string | null }>(DEVICE_PREF_SQL, [key]).data[0]?.value ?? null;
    const set = useCallback(
        (next: string | null) => {
            db.writeTransaction(async (tx) => {
                await tx.execute("DELETE FROM device_prefs WHERE id = ?", [key]);
                if (next !== null) {
                    await tx.execute(
                        "INSERT INTO device_prefs (id, value, updated_at) VALUES (?, ?, ?)",
                        [key, next, new Date().toISOString()],
                    );
                }
            }).catch(() => undefined);
        },
        [db, key],
    );
    return [value, set];
}

/** A JSON list kept on this device, newest first and capped at `max`. */
export function useDeviceList(key: string, max = 8): [string[], (next: string[]) => void] {
    const [raw, set] = useDevicePref(key);
    let list: string[] = [];
    try {
        const parsed: unknown = raw === null ? [] : JSON.parse(raw);
        if (Array.isArray(parsed)) list = parsed.filter((v): v is string => typeof v === "string");
    } catch {
        list = [];
    }
    const save = useCallback(
        (next: string[]) => {
            set(next.length === 0 ? null : JSON.stringify(next.slice(0, max)));
        },
        [set, max],
    );
    return [list, save];
}

/** `useLoad` for replica reads: still loading until this device has finished its first sync. */
export function useReplicaLoad(sources: LoadSource[], empty: boolean): Load {
    const synced = useStatus().hasSynced ?? false;
    return useLoad([...sources, { isLoading: !synced }], empty);
}

export interface PendingChange {
    id: string;
    label: string;
}

interface SyncState {
    online: boolean;
    hasSynced: boolean;
    pendingCount: number;
    pending: PendingChange[];
    lastSynced: string | null;
}

const TABLE_LABEL: Record<string, string> = {
    hours: strings.sync.tables.hours,
};

/** A sentence for one change waiting in the upload queue ("Working hours changed"). */
export function pendingLabel(table: string, op: string): string {
    const kind = TABLE_LABEL[table] ?? strings.sync.tables.other;
    return op === "DELETE" ? strings.sync.removed(kind) : strings.sync.changed(kind);
}

/** Connection, first sync and the changes this device has not uploaded yet, polled while mounted. */
export function useSyncState(pollMs = 3000): SyncState {
    const db = usePowerSync();
    const status = useStatus();
    const [pending, setPending] = useState<PendingChange[]>([]);
    useEffect(() => {
        let live = true;
        const read = (): void => {
            db.getCrudBatch(50)
                .then((batch) => {
                    if (!live) return;
                    setPending(
                        (batch?.crud ?? []).map((c) => ({
                            id: String(c.clientId),
                            label: pendingLabel(c.table, c.op),
                        })),
                    );
                })
                .catch(() => undefined);
        };
        read();
        const timer = setInterval(read, pollMs);
        return () => {
            live = false;
            clearInterval(timer);
        };
    }, [db, pollMs]);
    const last = status.lastSyncedAt;
    return {
        online: status.connected,
        hasSynced: status.hasSynced ?? false,
        pendingCount: pending.length,
        pending,
        lastSynced: last === undefined ? null : formatTime(last),
    };
}
