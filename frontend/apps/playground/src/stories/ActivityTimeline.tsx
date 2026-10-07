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
        {
            key: "intents",
            title: "Every intent",
            props: () => ({
                entries: (["accent", "success", "warning", "danger", "neutral"] as const).map(
                    (intent, i) => ({
                        key: intent,
                        label: `${intent[0]?.toUpperCase() ?? ""}${intent.slice(1)} entry`,
                        at: `Oct ${String(i + 1)}`,
                        intent,
                        icon: "check" as const,
                    }),
                ),
            }),
        },
        {
            key: "long",
            title: "Long text and a right-to-left name",
            props: () => ({
                entries: [
                    {
                        key: "1",
                        label: "Reminder sent to Bartholomew Featherstonehaugh-Montgomery about Saturday's full groom, nail trim and teeth cleaning",
                        detail: "By text to +1 250 555 0101, then by email to bartholomew.featherstonehaugh@example.com",
                        at: "Oct 4, 11:59 p.m.",
                        aside: "$1,240.00",
                        icon: "message",
                    },
                    {
                        key: "2",
                        label: "ليلى حداد دفعت الفاتورة",
                        detail: "נועה כהן",
                        at: "Oct 5",
                        intent: "success",
                        quote: "Supercalifragilisticexpialidocious-unbroken-word-that-should-wrap-inside-the-quote-box-and-not-overflow",
                    },
                ],
            }),
        },
        { key: "empty", title: "No entries", props: () => ({ entries: [] }) },
    ],
});
