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
            key: "title-only",
            title: "Strip, title only",
            props: () => ({ state: "syncing", title: "Syncing" }),
        },
        {
            key: "long",
            title: "Strip, long detail",
            props: () => ({
                state: "error",
                title: "Sync failed",
                detail: "4 changes to bookings, 2 client notes and a signed waiver for Biscuit didn't upload because the server refused them.",
                action: { label: "See what failed", onPress: noop },
            }),
        },
        {
            key: "rtl",
            title: "Strip, Hebrew copy",
            props: () => ({
                state: "offline",
                title: "אין חיבור",
                detail: "השינויים יסונכרנו כשהחיבור יחזור.",
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
        {
            key: "card-long",
            title: "Offline card, long detail with an action",
            props: () => ({
                state: "offline",
                variant: "card",
                title: "You're offline",
                detail: "3 changes are saved on this device and will sync when you reconnect. Last synced at 9:04 a.m.",
                action: { label: "Try again", onPress: noop },
            }),
        },
        {
            key: "card-syncing",
            title: "Syncing card",
            props: () => ({
                state: "syncing",
                variant: "card",
                title: "Catching up",
                detail: "Uploading 12 changes made while you were offline.",
            }),
        },
        {
            key: "card-error",
            title: "Error card",
            props: (k) => ({
                state: "error",
                variant: "card",
                title: "Some changes didn't sync",
                detail: "The server refused 2 changes. Review them before they're lost.",
                action: { label: "Review", onPress: noop },
                children: <k.Text>Moved Diego's groom to 2:30 p.m.</k.Text>,
            }),
        },
    ],
});
