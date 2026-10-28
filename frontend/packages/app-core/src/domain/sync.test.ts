// @vitest-environment happy-dom
import type { CommonPowerSyncDatabase } from "@powersync/common";
import { PowerSyncContext } from "@powersync/react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { type ReactNode, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BusinessZoneContext } from "../datetime";
import {
    UPLOAD_NOTICE_AFTER_MS,
    arrivalState,
    boundedOpen,
    isStorageFull,
    replicaStorage,
    syncNotice,
    syncProblem,
    useSyncStatus,
    useReplicaSession,
    useSyncState,
    type OpfsProbe,
} from "./sync";

// unmount each hook, so a ticking timer cannot render after the file's DOM is torn down
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe("replicaStorage", () => {
    const webkit = "Apple Computer, Inc.";
    const answer = (probe: OpfsProbe) => () => Promise.resolve(probe);

    it("keeps WebKit's replica in OPFS and every other engine's in IndexedDB", async () => {
        const probe = vi.fn(answer({ granted: true }));
        expect(await replicaStorage(webkit, probe)).toBe("opfs");
        expect(await replicaStorage("Google Inc.", probe)).toBe("indexeddb");
        expect(await replicaStorage("", probe)).toBe("indexeddb");
        expect(probe).toHaveBeenCalledTimes(1);
    });

    it("falls back to IndexedDB only when OPFS sync access is refused", async () => {
        const refused = answer({ granted: false, error: "InvalidStateError" });
        expect(await replicaStorage(webkit, refused)).toBe("indexeddb");
    });

    it("keeps OPFS on a full disk, so the file with unsent edits stays in use", async () => {
        const full = answer({ granted: false, error: "QuotaExceededError" });
        expect(await replicaStorage(webkit, full)).toBe("opfs");
    });

    it("fails as stuck when the probe never answers, rather than falling back", async () => {
        await expect(replicaStorage(webkit, answer(null))).rejects.toMatchObject({
            code: "replica_stuck",
        });
    });
});

describe("sync health", () => {
    it("reports failed uploads even while downloads are healthy", () => {
        expect(syncProblem(false, true, false)).toBe("upload");
    });
    it("reports unreadable local work ahead of transport failures", () => {
        expect(syncProblem(true, true, true)).toBe("storage");
    });
    it("reports download failures separately and clears after recovery", () => {
        expect(syncProblem(false, false, true)).toBe("download");
        expect(syncProblem(false, false, false)).toBeNull();
    });
    it("names a full device instead of a transport failure", () => {
        expect(isStorageFull(new Error("SqliteException(13): database or disk is full"))).toBe(
            true,
        );
        expect(isStorageFull(new DOMException("quota", "QuotaExceededError"))).toBe(true);
        expect(isStorageFull(new Error("disk I/O error"))).toBe(true);
        expect(isStorageFull(new Error("Failed to fetch"))).toBe(false);
        expect(isStorageFull(undefined)).toBe(false);
        expect(syncProblem(false, true, true, true)).toBe("full");
        expect(syncProblem(true, false, false, true)).toBe("storage");
    });
});

describe("syncNotice", () => {
    const calm = {
        online: true,
        hasSynced: true,
        pendingCount: 0,
        awaitingCount: 0,
        lastSynced: null,
        problem: null,
        firstSyncFailed: false,
        pendingSince: null,
    };
    const now = 1_000_000;

    it("shows nothing when this device has nothing left to send", () => {
        expect(syncNotice(calm, now)).toBeNull();
    });
    it("needs attention ahead of every other state, and offers a retry only for downloads", () => {
        expect(syncNotice({ ...calm, problem: "upload", online: false }, now)).toMatchObject({
            state: "error",
            retry: false,
        });
        expect(syncNotice({ ...calm, problem: "download" }, now)?.retry).toBe(true);
    });
    it("explains a first sync that has not arrived and offers a retry", () => {
        expect(
            syncNotice({ ...calm, hasSynced: false, online: false, firstSyncFailed: true }, now),
        ).toMatchObject({ state: "error", title: "Your data hasn’t loaded yet", retry: true });
        expect(syncNotice({ ...calm, hasSynced: false, firstSyncFailed: false }, now)).toBeNull();
    });
    it("calls offline work saved on this device, never saved on the server", () => {
        const notice = syncNotice({ ...calm, online: false, pendingCount: 2 }, now);
        expect(notice?.state).toBe("offline");
        expect(notice?.detail).toBe("2 changes will sync when you reconnect");
    });
    it("reports uploads only once a change has waited past the threshold", () => {
        const waiting = { ...calm, pendingCount: 51 };
        expect(
            syncNotice({ ...waiting, pendingSince: now - UPLOAD_NOTICE_AFTER_MS + 1 }, now),
        ).toBeNull();
        expect(
            syncNotice({ ...waiting, pendingSince: now - UPLOAD_NOTICE_AFTER_MS }, now)?.detail,
        ).toBe("51 changes are saved on this device and still on their way to the server");
    });
});

it("distinguishes accepted work waiting for replication from unsent work", () => {
    const notice = syncNotice(
        {
            online: true,
            hasSynced: true,
            pendingCount: 1,
            awaitingCount: 1,
            lastSynced: null,
            problem: null,
            firstSyncFailed: false,
            pendingSince: 0,
        },
        30_000,
    );
    expect(notice?.title).toBe("Waiting for updated data");
});

describe("arrivalState", () => {
    const paid = { arrived: (balance: number) => balance <= 0, started: 0 };

    it("is quiet when nothing was expected or the result already arrived", () => {
        expect(arrivalState(undefined, 500, 1_000)).toBeNull();
        expect(arrivalState(paid, 0, 1_000)).toBeNull();
    });
    it("waits for a bounded time, then says the result is late instead of failing", () => {
        expect(arrivalState(paid, 500, 14_999)).toBe("arriving");
        expect(arrivalState(paid, 500, 15_000)).toBe("late");
    });
    it("lets the replica speak for itself once the late notice has run its course", () => {
        expect(arrivalState(paid, 500, 120_000)).toBeNull();
    });
});

describe("useSyncStatus", () => {
    it("keeps a first sync that lands between the render and the subscription", () => {
        const waiting = { hasSynced: false };
        const synced = { hasSynced: true };
        const listeners = new Set<{ statusChanged?: (status: unknown) => void }>();
        let status: { hasSynced: boolean } = waiting;
        let reads = 0;
        const db = {
            get currentStatus() {
                const seen = status;
                // the shared sync worker finishes the first sync right after this render read it
                if (++reads === 1) {
                    status = synced;
                    for (const listener of listeners) listener.statusChanged?.(status);
                }
                return seen;
            },
            registerListener(listener: { statusChanged?: (status: unknown) => void }) {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
        } as unknown as CommonPowerSyncDatabase;
        const wrapper = ({ children }: { children: ReactNode }) =>
            createElement(PowerSyncContext.Provider, { value: db }, children);
        const { result } = renderHook(() => useSyncStatus().hasSynced, { wrapper });
        expect(result.current).toBe(true);
    });
});

it("checks whether timed-out restore is invalidated before its delayed side effects", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const auth = new Promise<void>((resolve) => {
        finish = resolve;
    });
    let activated = false;
    const options = {
        restore: async (stale: () => boolean) => {
            await auth;
            if (stale()) return null;
            activated = true;
            return null;
        },
        pause: vi.fn(() => Promise.resolve()),
        discard: () => Promise.resolve(),
        clearCredentials: () => Promise.resolve(),
        subscribe: () => undefined,
    };
    const { result } = renderHook(() => useReplicaSession(options));
    await act(async () => {
        await vi.advanceTimersByTimeAsync(30_001);
    });
    expect(result.current.failed).toBe("load");
    expect(options.pause).toHaveBeenCalled();
    await act(async () => {
        finish();
        await Promise.resolve();
    });
    expect(activated).toBe(false);
});

describe("a replica that doesn't open", () => {
    it("abandons the open and fails as stuck after 20 seconds", async () => {
        vi.useFakeTimers();
        const abandon = vi.fn();
        const open = boundedOpen(new Promise<never>(() => undefined), abandon);
        const outcome = expect(open).rejects.toMatchObject({ code: "replica_stuck" });
        await vi.advanceTimersByTimeAsync(19_999);
        expect(abandon).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await outcome;
        expect(abandon).toHaveBeenCalledTimes(1);
    });

    it("passes an open that answers in time and abandons nothing", async () => {
        const abandon = vi.fn();
        expect(await boundedOpen(Promise.resolve("db"), abandon)).toBe("db");
        expect(abandon).not.toHaveBeenCalled();
    });

    it("maps replica_stuck to the stuck failure without queueing a pause behind the open", async () => {
        const options = {
            restore: () =>
                Promise.reject(Object.assign(new Error("stuck"), { code: "replica_stuck" })),
            pause: vi.fn(() => Promise.resolve()),
            discard: () => Promise.resolve(),
            clearCredentials: () => Promise.resolve(),
            subscribe: () => undefined,
        };
        const { result } = renderHook(() => useReplicaSession(options));
        await act(async () => {
            await Promise.resolve();
        });
        expect(result.current.failed).toBe("stuck");
        expect(result.current.retry).toBe(result.current.restore);
        expect(options.pause).not.toHaveBeenCalled();
    });
});

describe("a session check while the app is open", () => {
    const db = {} as CommonPowerSyncDatabase;
    const session = (validate: () => Promise<void>) => {
        let resume: () => void = () => undefined;
        const options = {
            restore: vi.fn(() => Promise.resolve(db)),
            validate,
            subscribeResume: (refresh: () => void) => {
                resume = refresh;
                return () => undefined;
            },
            pause: () => Promise.resolve(),
            discard: () => Promise.resolve(),
            clearCredentials: () => Promise.resolve(),
            subscribe: () => undefined,
        };
        return {
            options,
            resume: () => {
                resume();
            },
        };
    };

    it.each([403, 429])("keeps the app open when /v1/me answers %i", async (status) => {
        const { options, resume } = session(() =>
            Promise.reject(Object.assign(new Error("refused"), { status })),
        );
        const { result } = renderHook(() => useReplicaSession(options));
        await act(async () => {
            await Promise.resolve();
        });
        expect(result.current.db).toBe(db);
        await act(async () => {
            resume();
            await Promise.resolve();
        });
        expect(options.restore).toHaveBeenCalledTimes(1);
        expect(result.current.db).toBe(db);
    });

    it("restores when the session is gone", async () => {
        const { options, resume } = session(() => Promise.reject(new Error("signed out")));
        renderHook(() => useReplicaSession(options));
        await act(async () => {
            await Promise.resolve();
        });
        await act(async () => {
            resume();
            await Promise.resolve();
        });
        expect(options.restore).toHaveBeenCalledTimes(2);
    });
});

describe("a first sync that is still downloading", () => {
    it("isn't reported as failed while operations keep arriving", async () => {
        vi.useFakeTimers();
        const listeners = new Set<{ statusChanged?: (status: unknown) => void }>();
        const status = (downloaded: number) => ({
            connected: true,
            hasSynced: false,
            downloadProgress: { downloadedOperations: downloaded },
        });
        let current = status(0);
        const db = {
            get currentStatus() {
                return current;
            },
            registerListener(listener: { statusChanged?: (status: unknown) => void }) {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
            getAll: () => Promise.resolve([]),
            get: () => Promise.resolve({ count: 0, failed: 0, awaiting: 0, oldest: null }),
        } as unknown as CommonPowerSyncDatabase;
        const wrapper = ({ children }: { children: ReactNode }) =>
            createElement(
                PowerSyncContext.Provider,
                { value: db },
                createElement(BusinessZoneContext.Provider, { value: "America/Toronto" }, children),
            );
        const { result } = renderHook(() => useSyncState(60_000), { wrapper });
        for (const downloaded of [500, 1000, 1500]) {
            await act(async () => {
                await vi.advanceTimersByTimeAsync(15_000);
                current = status(downloaded);
                for (const listener of listeners) listener.statusChanged?.(current);
            });
        }
        expect(result.current.firstSyncFailed).toBe(false);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(20_000);
        });
        expect(result.current.firstSyncFailed).toBe(true);
    });
});
