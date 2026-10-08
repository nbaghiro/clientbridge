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
        icon: { type: "select", options: ["calendar", "clients", "inbox", "alert", "search"] },
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
        {
            key: "card-error",
            title: "Card, failed load with two actions",
            props: (k) => ({
                message: "Couldn't reach the payment service",
                body: "Payouts will show here again once the connection is back.",
                icon: "alert",
                intent: "danger",
                variant: "card",
                actions: (
                    <k.Stack row>
                        <k.Button size="sm" icon="refresh">
                            Retry
                        </k.Button>
                        <k.Button size="sm" variant="outline">
                            Status page
                        </k.Button>
                    </k.Stack>
                ),
            }),
        },
        {
            key: "search",
            title: "No search results",
            props: () => ({
                message: "No clients match “Featherstonehaugh”",
                icon: "search",
            }),
        },
        {
            key: "long",
            title: "Long message and body",
            props: () => ({
                message:
                    "No gift cards have been sold or redeemed in the period you picked, across any of your locations",
                body: "Gift cards appear here once a client buys one at the register, online through your booking page, or when you issue one by hand as a goodwill credit after a missed appointment.",
                icon: "tag",
                variant: "card",
            }),
        },
        {
            key: "rtl",
            title: "Right-to-left",
            props: () => ({
                message: "لا توجد حجوزات هذا الأسبوع",
                body: "شارك صفحة الحجز أو أضف زيارة بنفسك.",
                icon: "calendar",
            }),
        },
    ],
});
