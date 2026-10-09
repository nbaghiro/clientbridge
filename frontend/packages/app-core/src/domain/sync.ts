import type { CommonPowerSyncDatabase } from "@powersync/common";
import { usePowerSync, useQuery, useStatus } from "@powersync/react";
import { useCallback, useEffect, useRef, useState } from "react";

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
    queueKnown: boolean;
    pending: PendingChange[];
    lastSynced: string | null;
    problem: "storage" | "upload" | "download" | null;
}

export function syncProblem(
    storageFailed: boolean,
    uploadFailed: boolean,
    downloadFailed: boolean,
): SyncState["problem"] {
    return storageFailed ? "storage" : uploadFailed ? "upload" : downloadFailed ? "download" : null;
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
    const [pendingCount, setPendingCount] = useState(0);
    const [queueKnown, setQueueKnown] = useState(false);
    const [queueFailed, setQueueFailed] = useState(false);
    const [outboxFailed, setOutboxFailed] = useState(false);
    useEffect(() => {
        let live = true;
        setQueueKnown(false);
        setQueueFailed(false);
        setOutboxFailed(false);
        setPending([]);
        setPendingCount(0);
        const read = (): void => {
            Promise.all([
                db.getCrudBatch(50),
                db.getUploadQueueStats(),
                db.getAll<{ id: string; error_code: string | null }>(
                    "SELECT o.id, o.error_code FROM hours_outbox o LEFT JOIN staff s ON s.id = o.staff_id WHERE o.state != 'accepted' OR s.hours_revision IS NULL OR s.hours_revision < o.result_revision ORDER BY o.sequence LIMIT 50",
                ),
                db.get<{ count: number; failed: number }>(
                    "SELECT count(*) AS count, COALESCE(SUM(CASE WHEN o.error_code IS NOT NULL THEN 1 ELSE 0 END), 0) AS failed FROM hours_outbox o LEFT JOIN staff s ON s.id = o.staff_id WHERE o.state != 'accepted' OR s.hours_revision IS NULL OR s.hours_revision < o.result_revision",
                ),
            ])
                .then(([batch, stats, outbox, total]) => {
                    if (!live) return;
                    setPendingCount(stats.count + total.count);
                    setOutboxFailed(total.failed > 0);
                    setQueueKnown(true);
                    setQueueFailed(false);
                    setPending(
                        [
                            ...(batch?.crud ?? []).map((c) => ({
                                id: String(c.clientId),
                                label: pendingLabel(c.table, c.op),
                            })),
                            ...outbox.map((row) => ({
                                id: row.id,
                                label: pendingLabel("hours", "PATCH"),
                            })),
                        ].slice(0, 50),
                    );
                })
                .catch(() => {
                    if (live) {
                        setQueueKnown(false);
                        setQueueFailed(true);
                    }
                });
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
        pendingCount,
        queueKnown,
        pending,
        lastSynced: last === undefined ? null : formatTime(last),
        problem: syncProblem(
            queueFailed,
            outboxFailed || !!status.uploadError,
            !!status.downloadError,
        ),
    };
}

interface ReplicaSessionOptions {
    restore: () => Promise<CommonPowerSyncDatabase | null>;
    pause: () => Promise<void>;
    discard: () => Promise<void>;
    clearCredentials: () => Promise<void>;
    subscribe: (handler: () => void) => void;
    subscribeChanged?: (handler: () => void) => void;
    onReady?: () => void;
}

function bounded<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error("session initialization timed out"));
        }, 30_000);
    });
    return Promise.race([work, timeout]).finally(() => {
        clearTimeout(timer);
    });
}

export function useReplicaSession(options: ReplicaSessionOptions) {
    const [db, setDb] = useState<CommonPowerSyncDatabase | null>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState<"load" | "discard" | "reauthenticate" | null>(null);
    const generation = useRef(0);
    const run = useCallback(
        async (action: "load" | "discard" | "reauthenticate"): Promise<void> => {
            const current = ++generation.current;
            setDb(null);
            setLoading(true);
            setFailed(null);
            try {
                const next =
                    action === "load"
                        ? await bounded(options.restore())
                        : await bounded(
                              action === "discard" ? options.discard() : options.clearCredentials(),
                          ).then(() => null);
                if (current === generation.current) {
                    setDb(next);
                    if (next) options.onReady?.();
                }
            } catch {
                if (current === generation.current) {
                    setFailed(action);
                    options.pause().catch(() => undefined);
                }
            } finally {
                if (current === generation.current) setLoading(false);
            }
        },
        [options],
    );
    const restore = useCallback(() => {
        run("load").catch(() => {
            setFailed("load");
        });
    }, [run]);
    const discard = useCallback(() => {
        run("discard").catch(() => {
            setFailed("discard");
        });
    }, [run]);
    const reauthenticate = useCallback(() => {
        run("reauthenticate").catch(() => {
            setFailed("reauthenticate");
        });
    }, [run]);
    useEffect(() => {
        options.subscribe(() => {
            const current = ++generation.current;
            setDb(null);
            setLoading(true);
            setFailed(null);
            bounded(options.pause())
                .catch(() => {
                    if (current === generation.current) setFailed("load");
                })
                .finally(() => {
                    if (current === generation.current) setLoading(false);
                });
        });
        options.subscribeChanged?.(restore);
        restore();
        return () => {
            ++generation.current;
            options.subscribe(() => undefined);
            options.subscribeChanged?.(() => undefined);
            options.pause().catch(() => undefined);
        };
    }, [options, restore]);
    return {
        db,
        loading,
        failed,
        restore,
        discard,
        reauthenticate,
        retry:
            failed === "discard" ? discard : failed === "reauthenticate" ? reauthenticate : restore,
    };
}
