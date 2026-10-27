// @vitest-environment happy-dom
import type { CommonPowerSyncDatabase } from "@powersync/common";
import { PowerSyncContext } from "@powersync/react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { type ReactNode, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    UPLOAD_NOTICE_AFTER_MS,
    arrivalState,
    isStorageFull,
    replicaStorage,
    syncNotice,
    syncProblem,
    useSyncStatus,
    useReplicaSession,
} from "./sync";

// unmount each hook, so a ticking timer cannot render after the file's DOM is torn down
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe("replicaStorage", () => {
    it("keeps WebKit's replica in OPFS and every other engine's in IndexedDB", () => {
        expect(replicaStorage("Apple Computer, Inc.")).toBe("opfs");
        expect(replicaStorage("Google Inc.")).toBe("indexeddb");
        expect(replicaStorage("")).toBe("indexeddb");
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
