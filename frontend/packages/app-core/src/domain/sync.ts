import type { CommonPowerSyncDatabase } from "@powersync/common";
import { usePowerSync, useQuery, useStatus } from "@powersync/react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { formatTime, useBusinessZone } from "../datetime";
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

const ARRIVAL_TIMEOUT_MS = 15_000;
// a late result keeps its notice this long, then the screen trusts the replica again
const ARRIVAL_FORGET_MS = 120_000;

interface Expectation {
    arrived: (current: number) => boolean;
    started: number;
}

const expectations = new Map<string, Expectation>();
const arrivalListeners = new Set<() => void>();

function notifyArrivals(): void {
    for (const listener of arrivalListeners) listener();
}

/** Record that a command succeeded and its result should reach this device's replica soon. */
export function expectArrival(key: string, arrived: (current: number) => boolean): void {
    expectations.set(key, { arrived, started: Date.now() });
    notifyArrivals();
    setTimeout(notifyArrivals, ARRIVAL_TIMEOUT_MS + 50);
    setTimeout(notifyArrivals, ARRIVAL_FORGET_MS + 50);
}

export type Arrival = "arriving" | "late" | null;

export function arrivalState(
    expectation: Expectation | undefined,
    current: number,
    now: number,
): Arrival {
    if (expectation === undefined || expectation.arrived(current)) return null;
    const waited = now - expectation.started;
    return waited < ARRIVAL_TIMEOUT_MS ? "arriving" : waited < ARRIVAL_FORGET_MS ? "late" : null;
}

/** Whether a command's expected result has reached the replica: null once it has (or never was). */
export function useArrival(key: string | null, current: number): Arrival {
    const [, rerender] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
        arrivalListeners.add(rerender);
        return () => {
            arrivalListeners.delete(rerender);
        };
    }, []);
    const expectation = key === null ? undefined : expectations.get(key);
    const state = arrivalState(expectation, current, Date.now());
    useEffect(() => {
        if (key !== null && state === null && expectations.get(key) === expectation)
            expectations.delete(key);
    }, [key, state, expectation]);
    return state;
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
    problem: "storage" | "full" | "upload" | "download" | null;
    firstSyncFailed: boolean;
    // when the queue last went from empty to holding a change, in epoch milliseconds
    pendingSince: number | null;
    notice: SyncNotice | null;
}

const FIRST_SYNC_TIMEOUT_MS = 20_000;
export const UPLOAD_NOTICE_AFTER_MS = 15_000;

export interface SyncNotice {
    state: "offline" | "syncing" | "error";
    title: string;
    detail: string;
    retry: boolean;
}

type NoticeInput = Pick<
    SyncState,
    | "online"
    | "hasSynced"
    | "pendingCount"
    | "lastSynced"
    | "problem"
    | "firstSyncFailed"
    | "pendingSince"
>;

/** The one sync message a shell shows, or null when everything on this device is on the server. */
export function syncNotice(sync: NoticeInput, now: number): SyncNotice | null {
    const s = strings.sync;
    if (sync.problem !== null) {
        return {
            state: "error",
            title: s.problemTitle,
            detail: s.problems[sync.problem],
            retry: sync.problem === "download",
        };
    }
    if (!sync.hasSynced && sync.firstSyncFailed) {
        return { state: "error", title: s.firstSyncTitle, detail: s.firstSyncBody, retry: true };
    }
    if (!sync.online && sync.hasSynced) {
        const strip = s.offlineStrip(sync.pendingCount);
        return {
            state: "offline",
            title: s.offlineTitle,
            detail:
                sync.lastSynced === null
                    ? strip
                    : strings.common.titleAndBody(strip, s.lastSynced(sync.lastSynced)),
            retry: false,
        };
    }
    if (
        sync.online &&
        sync.pendingCount > 0 &&
        sync.pendingSince !== null &&
        now - sync.pendingSince >= UPLOAD_NOTICE_AFTER_MS
    ) {
        return {
            state: "syncing",
            title: s.uploadingTitle,
            detail: s.uploadingStrip(sync.pendingCount),
            retry: false,
        };
    }
    return null;
}

const STORAGE_FULL = /SQLITE_FULL|disk is full|QuotaExceeded|quota/i;

/** Whether a sync error came from the device running out of space rather than the network. */
export function isStorageFull(error: unknown): boolean {
    return error instanceof Error && STORAGE_FULL.test(`${error.name} ${error.message}`);
}

export function syncProblem(
    storageFailed: boolean,
    uploadFailed: boolean,
    downloadFailed: boolean,
    storageFull = false,
): SyncState["problem"] {
    if (storageFailed) return "storage";
    if (storageFull) return "full";
    return uploadFailed ? "upload" : downloadFailed ? "download" : null;
}

/** Connection, first sync and the changes this device has not uploaded yet, polled while mounted. */
export function useSyncState(pollMs = 3000): SyncState {
    const db = usePowerSync();
    const zone = useBusinessZone();
    const status = useStatus();
    const [pending, setPending] = useState<PendingChange[]>([]);
    const [pendingCount, setPendingCount] = useState(0);
    const [queueKnown, setQueueKnown] = useState(false);
    const [queueFailed, setQueueFailed] = useState(false);
    const [outboxFailed, setOutboxFailed] = useState(false);
    const [now, setNow] = useState(() => Date.now());
    const [stalled, setStalled] = useState(false);
    const pendingSince = useRef<number | null>(null);
    const hasSynced = status.hasSynced ?? false;
    useEffect(() => {
        if (hasSynced) return undefined;
        setStalled(false);
        const timer = setTimeout(() => {
            setStalled(true);
        }, FIRST_SYNC_TIMEOUT_MS);
        return () => {
            clearTimeout(timer);
        };
    }, [hasSynced]);
    useEffect(() => {
        let live = true;
        setQueueKnown(false);
        setQueueFailed(false);
        setOutboxFailed(false);
        setPending([]);
        setPendingCount(0);
        const read = (): void => {
            Promise.all([
                db.getAll<{ id: string }>(
                    "SELECT o.id FROM hours_outbox o LEFT JOIN staff s ON s.id = o.staff_id WHERE o.state != 'accepted' OR s.hours_revision IS NULL OR s.hours_revision < o.result_revision ORDER BY o.sequence LIMIT 50",
                ),
                db.get<{ count: number; failed: number }>(
                    "SELECT count(*) AS count, COALESCE(SUM(CASE WHEN o.error_code IS NOT NULL THEN 1 ELSE 0 END), 0) AS failed FROM hours_outbox o LEFT JOIN staff s ON s.id = o.staff_id WHERE o.state != 'accepted' OR s.hours_revision IS NULL OR s.hours_revision < o.result_revision",
                ),
            ])
                .then(([outbox, total]) => {
                    if (!live) return;
                    if (total.count === 0) pendingSince.current = null;
                    else pendingSince.current ??= Date.now();
                    setNow(Date.now());
                    setPendingCount(total.count);
                    setOutboxFailed(total.failed > 0);
                    setQueueKnown(true);
                    setQueueFailed(false);
                    setPending(
                        outbox.map((row) => ({ id: row.id, label: strings.sync.hoursChanged })),
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
    const state = {
        online: status.connected,
        hasSynced,
        pendingCount,
        queueKnown,
        pending,
        lastSynced: last === undefined ? null : formatTime(last, zone),
        problem: syncProblem(
            queueFailed,
            outboxFailed || !!status.uploadError,
            hasSynced && !!status.downloadError,
            isStorageFull(status.downloadError) || isStorageFull(status.uploadError),
        ),
        firstSyncFailed: !hasSynced && (stalled || !!status.downloadError),
        pendingSince: pendingSince.current,
    };
    return { ...state, notice: syncNotice(state, now) };
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
