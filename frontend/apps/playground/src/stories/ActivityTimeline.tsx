import type { ActivityTimelineProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<ActivityTimelineProps>({
    component: "ActivityTimeline",
    summary: "What happened to a record, newest last, with optional glyphs, quotes and amounts.",
    examples: [
        {
            key: "plain",
            title: "Invoice history",
            props: () => ({
                entries: [
                    { key: "1", label: "Invoice created", at: "Oct 1, 9:12 a.m." },
                    {
                        key: "2",
                        label: "Sent to Amélie Tremblay",
                        detail: "By email",
                        at: "Oct 1, 9:13 a.m.",
                        intent: "accent",
                    },
                    { key: "3", label: "Viewed", at: "Oct 2, 7:40 p.m." },
                    {
                        key: "4",
                        label: "Paid in full",
                        detail: "Visa ending 4242",
                        at: "Oct 3, 8:01 a.m.",
                        intent: "success",
                    },
                ],
            }),
        },
        {
            key: "rich",
            title: "Client history with glyphs, quotes and amounts",
            props: () => ({
                entries: [
                    {
                        key: "1",
                        label: "Full groom for Biscuit",
                        at: "Sep 28",
                        icon: "calendar",
                        intent: "accent",
                        aside: "$95.20",
                    },
                    {
                        key: "2",
                        label: "Note added",
                        at: "Sep 28",
                        icon: "note",
                        quote: "Nervous around the dryer; use the quiet setting.",
                    },
                    {
                        key: "3",
                        label: "Text from Diego Ruiz",
                        at: "Oct 2",
                        icon: "message",
                        quote: "Can we move Friday to 3?",
                    },
                    {
                        key: "4",
                        label: "Payment failed",
                        at: "Oct 4",
                        icon: "alert",
                        intent: "danger",
                        aside: "$50.40",
                    },
                ],
            }),
        },
        { key: "empty", title: "No entries", props: () => ({ entries: [] }) },
    ],
});
