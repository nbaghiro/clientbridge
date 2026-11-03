// @vitest-environment happy-dom
import type { CommonPowerSyncDatabase } from "@powersync/common";
import { PowerSyncContext } from "@powersync/react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { type ReactNode, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { debugFacts, useClientState } from "./debug";

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe("useClientState", () => {
    it("polls on its interval, though every read of lastSyncedAt is a new Date", async () => {
        vi.useFakeTimers();
        const get = vi.fn(() => Promise.resolve({ waiting: 0 }));
        const getAll = vi.fn(() => Promise.resolve([]));
        const db = {
            currentStatus: {
                get lastSyncedAt() {
                    return new Date(1_800_000_000_000);
                },
            },
            registerListener: () => () => undefined,
            get,
            getAll,
        } as unknown as CommonPowerSyncDatabase;
        const wrapper = ({ children }: { children: ReactNode }) =>
            createElement(PowerSyncContext.Provider, { value: db }, children);
        renderHook(() => useClientState(1500), { wrapper });
        for (let settle = 0; settle < 20; settle++)
            await act(async () => {
                await Promise.resolve();
            });
        expect(get).toHaveBeenCalledTimes(1);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1500);
        });
        expect(get).toHaveBeenCalledTimes(2);
        expect(getAll).toHaveBeenCalledTimes(2);
    });
});

const NOW = new Date(2026, 9, 20, 16, 40, 30).getTime();
const idle = {
    connected: false,
    connecting: false,
    hasSynced: false,
    lastSyncedAt: undefined,
    downloading: false,
    uploading: false,
    downloadError: undefined,
    uploadError: undefined,
    downloadProgress: null,
};
const quiet = {
    waiting: 0,
    sending: 0,
    awaiting: 0,
    rejected: 0,
    oldest: null,
    replicationDelayMs: null,
};

function fact(facts: ReturnType<typeof debugFacts>, label: string) {
    return facts.find((f) => f.label === label);
}

describe("debugFacts", () => {
    it("reads a synced, idle device as plain rows instead of JSON", () => {
        const status = {
            ...idle,
            connected: true,
            hasSynced: true,
            lastSyncedAt: new Date(2026, 9, 20, 16, 40, 11),
        };
        const facts = debugFacts(status, { ...quiet, replicationDelayMs: "1250" }, NOW);
        expect(fact(facts, "connection")).toEqual({
            label: "connection",
            value: "connected",
            tone: "good",
        });
        expect(fact(facts, "last synced")?.value).toBe("16:40:11 (19s ago)");
        expect(fact(facts, "offline edits")?.value).toBe("none waiting");
        expect(fact(facts, "replication delay")?.value).toBe("1.3s");
        expect(fact(facts, "download error")).toBeUndefined();
    });

    it("flags waiting and rejected edits and sync errors", () => {
        const status = { ...idle, downloadError: new Error("token expired") };
        const facts = debugFacts(
            status,
            {
                ...quiet,
                waiting: 2,
                sending: 1,
                rejected: 1,
                oldest: new Date(2026, 9, 20, 16, 31, 5).toISOString(),
            },
            NOW,
        );
        expect(fact(facts, "connection")?.tone).toBe("bad");
        expect(fact(facts, "offline edits")?.value).toBe("3 waiting, oldest 16:31:05");
        expect(fact(facts, "rejected")).toEqual({ label: "rejected", value: "1", tone: "bad" });
        expect(fact(facts, "download error")?.value).toBe("token expired");
        expect(fact(facts, "replication delay")?.value).toBe("not measured");
    });
});
