import { describe, expect, it, vi, afterEach } from "vitest";
import type { CommonPowerSyncDatabase } from "@powersync/common";
import { rangeMonths, maintainHistory } from "@clientbridge/sync";

afterEach(() => vi.useRealTimers());
describe("history coverage", () => {
    it("covers UTC month boundaries with an exclusive end", () => {
        expect(
            rangeMonths(new Date("2026-10-31T23:00:00Z"), new Date("2026-11-01T01:00:00Z")),
        ).toEqual(["2026-10", "2026-11"]);
        expect(rangeMonths(new Date("2026-10-01Z"), new Date("2026-11-01Z"))).toEqual(["2026-10"]);
    });
    it("rolls the subscriptions and coverage while the same replica stays open", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-31T23:59:30Z"));
        const subscriptions: { months: string[]; unsubscribe: ReturnType<typeof vi.fn> }[] = [];
        const writes: unknown[][] = [];
        const db = {
            syncStream: (_name: string, params: { months: string[] }) => ({
                subscribe: () => {
                    const sub = {
                        months: params.months,
                        unsubscribe: vi.fn(),
                        waitForFirstSync: () => Promise.resolve(),
                    };
                    subscriptions.push(sub);
                    return Promise.resolve(sub);
                },
            }),
            writeTransaction: async (run: (tx: unknown) => Promise<void>) =>
                run({
                    execute: (...args: unknown[]) => {
                        writes.push(args);
                        return Promise.resolve();
                    },
                }),
        } as unknown as CommonPowerSyncDatabase;
        const stop = maintainHistory(db);
        await vi.advanceTimersByTimeAsync(1);
        expect(subscriptions).toHaveLength(3);
        expect(subscriptions[0]?.months[0]).toBe("2025-10");
        await vi.advanceTimersByTimeAsync(60_000);
        expect(subscriptions).toHaveLength(6);
        expect(subscriptions[3]?.months[0]).toBe("2025-11");
        expect(subscriptions[0]?.unsubscribe).toHaveBeenCalledOnce();
        expect(writes.length).toBeGreaterThan(37);
        stop();
        expect(subscriptions[3]?.unsubscribe).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(subscriptions).toHaveLength(6);
    });
});
