import type { CommonPowerSyncDatabase, SyncStreamSubscription } from "@powersync/common";

const HISTORY_STREAMS = ["history_shared", "history_self", "history_full"];
const MONTHS_BACK = 12;
// two years ahead so every upcoming visit is on the device
const MONTHS_AHEAD = 24;

function historyMonths(now: Date): string[] {
    const months: string[] = [];
    for (let offset = -MONTHS_BACK; offset <= MONTHS_AHEAD; offset++) {
        const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
        months.push(month.toISOString().slice(0, 7));
    }
    return months;
}

// the earliest moment this device keeps history for; anything before it is read from the API
export function historyStart(now: Date = new Date()): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - MONTHS_BACK, 1));
}

export function subscribeHistory(
    db: CommonPowerSyncDatabase,
    now: Date = new Date(),
): Promise<SyncStreamSubscription[]> {
    const months = historyMonths(now);
    return Promise.all(HISTORY_STREAMS.map((name) => db.syncStream(name, { months }).subscribe()));
}

export function rangeMonths(start: Date, end: Date): string[] {
    const months: string[] = [];
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    while (cursor < end) {
        months.push(cursor.toISOString().slice(0, 7));
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return months;
}

export async function subscribeMonths(db: CommonPowerSyncDatabase, months: string[]) {
    return Promise.all(HISTORY_STREAMS.map((name) => db.syncStream(name, { months }).subscribe()));
}

export async function recordHistory(db: CommonPowerSyncDatabase, months: string[]): Promise<void> {
    const expires = String(Date.now() + 23 * 60 * 60 * 1000);
    await db.writeTransaction(async (tx) => {
        for (const month of months)
            await tx.execute("INSERT OR REPLACE INTO device_prefs (id, value) VALUES (?, ?)", [
                `sync.history:${month}`,
                expires,
            ]);
    });
}

export function maintainHistory(db: CommonPowerSyncDatabase): () => void {
    let subscriptions: SyncStreamSubscription[] = [];
    let key = "";
    let stopped = false;
    let busy = false;
    const isStopped = () => stopped;
    const controller = new AbortController();
    const refresh = async () => {
        if (busy || stopped) return;
        busy = true;
        try {
            const months = historyMonths(new Date());
            const nextKey = months.join(",");
            if (key !== nextKey) {
                const next = await subscribeMonths(db, months);
                if (isStopped()) {
                    for (const subscription of next) subscription.unsubscribe();
                    return;
                }
                for (const subscription of subscriptions) subscription.unsubscribe();
                subscriptions = next;
                key = nextKey;
            }
            await Promise.all(subscriptions.map((s) => s.waitForFirstSync(controller.signal)));
            if (!isStopped()) await recordHistory(db, months);
        } catch {
            // The next tick retries without removing the last known coverage.
        } finally {
            busy = false;
        }
    };
    refresh().catch(() => undefined);
    const timer = setInterval(() => {
        refresh().catch(() => undefined);
    }, 60_000);
    return () => {
        stopped = true;
        controller.abort();
        clearInterval(timer);
        for (const subscription of subscriptions) subscription.unsubscribe();
    };
}
