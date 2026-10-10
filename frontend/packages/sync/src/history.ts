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
