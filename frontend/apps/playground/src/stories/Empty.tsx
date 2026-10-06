import type { EmptyProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<EmptyProps>({
    component: "Empty",
    summary: "Nothing here yet, or a failed load: one line, or an icon, body and next steps.",
    controls: {
        message: { type: "text" },
        body: { type: "text" },
        intent: { type: "select", options: ["neutral", "danger"] },
        variant: { type: "select", options: ["inline", "card"] },
    },
    examples: [
        { key: "line", title: "One line", props: () => ({ message: "No invoices yet." }) },
        {
            key: "next-step",
            title: "With an icon and a next step",
            props: (k) => ({
                message: "No bookings this week",
                body: "Share your booking page or add a visit yourself.",
                icon: "calendar",
                actions: (
                    <k.Button size="sm" icon="plus">
                        New booking
                    </k.Button>
                ),
            }),
        },
        {
            key: "card",
            title: "Card",
            props: (k) => ({
                message: "No clients yet",
                body: "Clients appear here when they book or you add them.",
                icon: "clients",
                variant: "card",
                actions: <k.Button size="sm">Add client</k.Button>,
            }),
        },
        {
            key: "error",
            title: "Failed load",
            props: (k) => ({
                message: "Couldn't load reports",
                body: "Check your connection and try again.",
                icon: "alert",
                intent: "danger",
                actions: (
                    <k.Button size="sm" variant="outline" icon="refresh">
                        Retry
                    </k.Button>
                ),
            }),
        },
    ],
});
