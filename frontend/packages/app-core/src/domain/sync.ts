import {
    rangeMonths,
    subscribeMonths,
    recordHistory,
    discardRejectedQueue,
} from "@clientbridge/sync";
import type { CommonPowerSyncDatabase, SyncStatus } from "@powersync/common";
import { usePowerSync, useQuery } from "@powersync/react";
import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";

import type { ApiLike } from "../api";
import {
    adoptZoneTable,
    formatTime,
    useBusinessZone,
    type ZoneTable,
    zoneTableVersion,
} from "../datetime";
import { type Load, type LoadSource, useLoad } from "../hooks";
import { strings } from "../strings";

export const DEVICE_PREF_SQL = "SELECT value FROM device_prefs WHERE id = ?";

type ReplicaStorage = "indexeddb" | "opfs";

/** WebKit's IndexedDB can stall reopening the replica after a reload, so WebKit keeps it in OPFS. */
export function replicaStorage(vendor: string): ReplicaStorage {
    const webkit: EngineVendor = "Apple Computer, Inc.";
    return vendor === webkit ? "opfs" : "indexeddb";
}

// the fixed navigator.vendor of each engine; Firefox reports an empty string
type EngineVendor = "Apple Computer, Inc." | "Google Inc." | "";

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

const ZONES_PREF = "zones.table";

const isZoneTable = (v: unknown): v is ZoneTable =>
    typeof v === "object" &&
    v !== null &&
    typeof (v as ZoneTable).version === "string" &&
    typeof (v as ZoneTable).zones === "object";

/** The server's zone table, kept on this device for app builds that bundle an older one; returns the version in use. */
export function useServerZones(api: ApiLike): string {
    const [stored, store] = useDevicePref(ZONES_PREF);
    const [version, setVersion] = useState(zoneTableVersion);
    useEffect(() => {
        if (stored === null) return;
        try {
            const table: unknown = JSON.parse(stored);
            if (isZoneTable(table) && adoptZoneTable(table)) setVersion(table.version);
        } catch {
            store(null);
        }
    }, [stored, store]);
    useEffect(() => {
        api.get<unknown>("/v1/zones")
            .then((table) => {
                if (isZoneTable(table) && table.version !== zoneTableVersion())
                    store(JSON.stringify(table));
            })
            .catch(() => undefined);
    }, [api, store]);
    return version;
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

/** The replica's sync status; unlike `useStatus` it cannot miss a change made before it subscribed. */
export function useSyncStatus(): SyncStatus {
    const db = usePowerSync();
    const subscribe = useCallback(
        (changed: () => void) => db.registerListener({ statusChanged: changed }),
        [db],
    );
    return useSyncExternalStore(subscribe, () => db.currentStatus);
}

/** `useLoad` for replica reads: still loading until this device has finished its first sync. */
export function useReplicaLoad(sources: LoadSource[], empty: boolean): Load {
    const synced = useSyncStatus().hasSynced ?? false;
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

interface PendingQueue {
    count: number;
    pending: PendingChange[];
}

interface SyncState {
    online: boolean;
    hasSynced: boolean;
    pendingCount: number;
    awaitingCount: number;
    queueKnown: boolean;
    rejectedCount: number;
    discardRejected: () => Promise<void>;
    // reads the queue now; null when it can't be read, so a sign-out never acts on a stale poll
    recheck: () => Promise<PendingQueue | null>;
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
    | "awaitingCount"
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
        const strip = s.offlineStrip(sync.pendingCount - sync.awaitingCount);
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
            title: sync.awaitingCount > 0 ? s.awaitingTitle : s.uploadingTitle,
            detail: sync.awaitingCount > 0 ? s.awaitingDetail : s.uploadingStrip(sync.pendingCount),
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

const OUTBOX_PENDING_SQL =
    "SELECT o.id FROM hours_outbox o LEFT JOIN staff s ON s.id = o.staff_id WHERE o.state != 'accepted' OR s.hours_revision IS NULL OR s.hours_revision < o.result_revision ORDER BY o.sequence LIMIT 50";
const OUTBOX_TOTAL_SQL =
    "SELECT count(*) AS count, MIN(o.created_at) AS oldest, COALESCE(SUM(CASE WHEN o.state = 'accepted' THEN 1 ELSE 0 END), 0) AS awaiting, COALESCE(SUM(CASE WHEN o.state = 'rejected' THEN 1 ELSE 0 END), 0) AS failed FROM hours_outbox o LEFT JOIN staff s ON s.id = o.staff_id WHERE o.state != 'accepted' OR s.hours_revision IS NULL OR s.hours_revision < o.result_revision";

async function readOutbox(db: CommonPowerSyncDatabase) {
    const [outbox, total] = await Promise.all([
        db.getAll<{ id: string }>(OUTBOX_PENDING_SQL),
        db.get<{ count: number; failed: number; awaiting: number; oldest: string | null }>(
            OUTBOX_TOTAL_SQL,
        ),
    ]);
    return { outbox, total };
}

/** Connection, first sync and the changes this device has not uploaded yet, polled while mounted. */
export function useSyncState(pollMs = 3000): SyncState {
    const db = usePowerSync();
    const zone = useBusinessZone();
    const status = useSyncStatus();
    const [pending, setPending] = useState<PendingChange[]>([]);
    const [pendingCount, setPendingCount] = useState(0);
    const [awaitingCount, setAwaitingCount] = useState(0);
    const [queueKnown, setQueueKnown] = useState(false);
    const [queueFailed, setQueueFailed] = useState(false);
    const [outboxFailed, setOutboxFailed] = useState(false);
    const [rejectedCount, setRejectedCount] = useState(0);
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
    const current = useRef(true);
    const read = useCallback(
        (live: () => boolean): Promise<PendingQueue | null> =>
            readOutbox(db)
                .then(({ outbox, total }) => {
                    const queue = {
                        count: total.count,
                        pending: outbox.map((row) => ({
                            id: row.id,
                            label: strings.sync.hoursChanged,
                        })),
                    };
                    if (!live()) return queue;
                    if (total.count === 0) pendingSince.current = null;
                    else
                        pendingSince.current =
                            total.oldest === null ? Date.now() : Date.parse(total.oldest);
                    setNow(Date.now());
                    setPendingCount(total.count);
                    setAwaitingCount(total.awaiting);
                    setOutboxFailed(total.failed > 0);
                    setRejectedCount(total.failed);
                    setQueueKnown(true);
                    setQueueFailed(false);
                    setPending(queue.pending);
                    return queue;
                })
                .catch(() => {
                    if (live()) {
                        setQueueKnown(false);
                        setQueueFailed(true);
                    }
                    return null;
                }),
        [db],
    );
    useEffect(() => {
        let live = true;
        const alive = (): boolean => live;
        current.current = true;
        setQueueKnown(false);
        setQueueFailed(false);
        setOutboxFailed(false);
        setPending([]);
        setPendingCount(0);
        read(alive).catch(() => undefined);
        const timer = setInterval(() => {
            read(alive).catch(() => undefined);
        }, pollMs);
        return () => {
            live = false;
            current.current = false;
            clearInterval(timer);
        };
    }, [read, pollMs]);
    const recheck = useCallback(() => read(() => current.current), [read]);
    const last = status.lastSyncedAt;
    const state = {
        online: status.connected,
        hasSynced,
        pendingCount,
        awaitingCount,
        queueKnown,
        rejectedCount,
        discardRejected: () => discardRejectedQueue(db),
        recheck,
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
    validate?: (stale: () => boolean) => Promise<void>;
    subscribeResume?: (refresh: () => void) => () => void;
    /** `stale()` turns true once a newer action replaced this one; it must then touch nothing. */
    restore: (stale: () => boolean) => Promise<CommonPowerSyncDatabase | "unverified" | null>;
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
    const [failed, setFailed] = useState<"load" | "discard" | "reauthenticate" | "offline" | null>(
        null,
    );
    // The API refuses the live session until its email is verified; sign-in must not probe it.
    const [unverified, setUnverified] = useState(false);
    const generation = useRef(0);
    const run = useCallback(
        async (action: "load" | "discard" | "reauthenticate"): Promise<void> => {
            const current = ++generation.current;
            let cancelled = false;
            setDb(null);
            setLoading(true);
            setFailed(null);
            setUnverified(false);
            try {
                const next =
                    action === "load"
                        ? await bounded(
                              options.restore(() => cancelled || current !== generation.current),
                          )
                        : await bounded(
                              action === "discard" ? options.discard() : options.clearCredentials(),
                          ).then(() => null);
                if (current === generation.current) {
                    setDb(next === "unverified" ? null : next);
                    setUnverified(next === "unverified");
                    if (next && next !== "unverified") options.onReady?.();
                }
            } catch (error) {
                cancelled = true;
                if (current === generation.current) {
                    setFailed(
                        error !== null &&
                            typeof error === "object" &&
                            "code" in error &&
                            error.code === "offline_access_expired"
                            ? "offline"
                            : action,
                    );
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
            setUnverified(false);
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
    useEffect(() => {
        const validateSession = options.validate;
        if (!db || !validateSession) return;
        let active = true;
        let busy = false;
        const validate = () => {
            if (busy) return;
            busy = true;
            let cancelled = false;
            const current = generation.current;
            bounded(validateSession(() => cancelled || !active || current !== generation.current))
                .catch(() => {
                    cancelled = true;
                    if (active && current === generation.current) restore();
                })
                .finally(() => {
                    busy = false;
                });
        };
        const timer = setInterval(validate, 60_000);
        const unsubscribe = options.subscribeResume?.(validate);
        return () => {
            active = false;
            clearInterval(timer);
            unsubscribe?.();
        };
    }, [db, options, restore]);
    return {
        db,
        loading,
        failed,
        unverified,
        restore,
        discard,
        reauthenticate,
        retry:
            failed === "discard" ? discard : failed === "reauthenticate" ? reauthenticate : restore,
    };
}

export function useHistoryRange(start: Date, end: Date): LoadSource & { unavailable: boolean } {
    const db = usePowerSync();
    const connected = useSyncStatus().connected;
    const months = rangeMonths(start, end);
    const key = months.join(",");
    const rows = useQuery<{ id: string; value: string }>(
        "SELECT id, value FROM device_prefs WHERE id LIKE 'sync.history:%'",
    );
    const covered = months.every((month) =>
        rows.data.some(
            (row) => row.id === `sync.history:${month}` && Number(row.value) > Date.now(),
        ),
    );
    const [failed, setFailed] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        if (!connected) return;
        const controller = new AbortController();
        let subscriptions: Awaited<ReturnType<typeof subscribeMonths>> = [];
        const timer = setTimeout(() => {
            controller.abort();
        }, 30_000);
        const isAborted = () => controller.signal.aborted;
        let loaded = false;
        const refreshCoverage = setInterval(() => {
            if (loaded) recordHistory(db, key.split(",")).catch(() => undefined);
        }, 60_000);
        setFailed(null);
        const load = async () => {
            try {
                subscriptions = await subscribeMonths(db, key.split(","));
                if (isAborted()) {
                    for (const subscription of subscriptions) subscription.unsubscribe();
                    return;
                }
                await Promise.all(subscriptions.map((s) => s.waitForFirstSync(controller.signal)));
                if (!isAborted()) {
                    await recordHistory(db, key.split(","));
                    loaded = true;
                    clearTimeout(timer);
                }
            } catch {
                if (!disposed) setFailed(key);
            }
        };
        let disposed = false;
        load().catch(() => undefined);
        return () => {
            disposed = true;
            controller.abort();
            clearTimeout(timer);
            clearInterval(refreshCoverage);
            for (const subscription of subscriptions) subscription.unsubscribe();
        };
    }, [db, key, connected, attempt]);
    const unavailable = !rows.isLoading && !covered && (!connected || failed === key);
    return {
        unavailable,
        isLoading: !covered && !unavailable,
        error: unavailable ? new Error("history unavailable") : rows.error,
        refresh: () => {
            setAttempt((v) => v + 1);
        },
    };
}
