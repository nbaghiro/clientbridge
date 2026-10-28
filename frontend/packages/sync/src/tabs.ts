import type { CommonPowerSyncDatabase } from "@powersync/common";
import type { WebDBAdapter } from "@powersync/web";

import type { ReplicaTabs } from "./lifecycle";

function isWebAdapter(adapter: object): adapter is WebDBAdapter {
    return "getConfiguration" in adapter;
}

const channelName = (filename: string) => `replica-sync:/${filename}`;
// held by a tab while it hands off; a page that dies releases it too
const handOffLock = (filename: string) => `replica-hand-off:/${filename}`;

/** Tabs that share PowerSync's sync worker, which runs unless multi-tab is off (WebKit, mobile browsers). */
export const browserTabs: ReplicaTabs = {
    shared: (db: CommonPowerSyncDatabase) =>
        isWebAdapter(db.database) && db.database.getConfiguration().enableMultiTabs,
    join: (filename, reconnect) => {
        const channel = new BroadcastChannel(channelName(filename));
        channel.onmessage = ({ data }: MessageEvent<unknown>) => {
            const handOff = String(data);
            const takeOver = async () => {
                await navigator.locks.request(
                    handOffLock(filename),
                    { mode: "shared" },
                    () => undefined,
                );
                // one tab per hand-off reconnects, so the stream restarts once
                await navigator.locks.request(
                    `${handOffLock(filename)}/${handOff}`,
                    { ifAvailable: true },
                    (lock) => (lock ? reconnect() : undefined),
                );
            };
            takeOver().catch(() => undefined);
        };
        return () => {
            channel.close();
        };
    },
    handOff: (filename, leave) =>
        navigator.locks.request(handOffLock(filename), async () => {
            const channel = new BroadcastChannel(channelName(filename));
            channel.postMessage(crypto.randomUUID());
            channel.close();
            await leave();
        }),
};
