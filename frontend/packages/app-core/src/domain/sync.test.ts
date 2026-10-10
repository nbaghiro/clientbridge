import { describe, expect, it } from "vitest";

import {
    UPLOAD_NOTICE_AFTER_MS,
    arrivalState,
    isStorageFull,
    syncNotice,
    syncProblem,
} from "./sync";

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
