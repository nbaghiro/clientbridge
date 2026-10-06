import type { SyncBannerProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

export default story<SyncBannerProps>({
    component: "SyncBanner",
    summary:
        "Offline, syncing or failed sync, as a slim strip or a card that explains what still works.",
    controls: {
        state: { type: "select", options: ["offline", "syncing", "error"] },
        variant: { type: "select", options: ["strip", "card"] },
        title: { type: "text" },
        detail: { type: "text" },
    },
    examples: [
        {
            key: "offline",
            title: "Offline strip",
            props: () => ({
                state: "offline",
                title: "You're offline",
                detail: "Changes will sync when you reconnect.",
            }),
        },
        {
            key: "syncing",
            title: "Syncing strip",
            props: () => ({ state: "syncing", title: "Syncing", detail: "3 changes left" }),
        },
        {
            key: "error",
            title: "Error strip with an action",
            props: () => ({
                state: "error",
                title: "Sync failed",
                detail: "2 changes didn't upload.",
                action: { label: "Retry", onPress: noop },
            }),
        },
        {
            key: "card",
            title: "Offline card",
            props: (k) => ({
                state: "offline",
                variant: "card",
                title: "You're offline",
                detail: "Bookings, clients and notes still work. Payments wait until you're back online.",
                action: { label: "Try again", onPress: noop },
                children: <k.Text tone="muted">Last synced 9:12 a.m.</k.Text>,
            }),
        },
    ],
});
