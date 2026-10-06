import type { StatProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<StatProps>({
    component: "Stat",
    summary: "A labelled figure, money or text, large on Today and smaller in Reports.",
    controls: {
        label: { type: "text" },
        size: { type: "select", options: ["md", "lg"] },
        tone: { type: "select", options: ["ink", "muted", "success", "danger"] },
        hint: { type: "text" },
    },
    examples: [
        {
            key: "money",
            title: "Money",
            props: () => ({
                label: "Today's revenue",
                cents: 48_400,
                tone: "success",
                hint: "received today",
            }),
        },
        {
            key: "large",
            title: "Large headline",
            props: () => ({
                label: "Awaiting payment",
                cents: 35_616,
                size: "lg",
                hint: "outstanding invoices",
            }),
        },
        {
            key: "text",
            title: "Text value",
            props: () => ({
                label: "Visits this week",
                value: "23",
                hint: "4 more than last week",
            }),
        },
        {
            key: "danger",
            title: "Danger",
            props: () => ({ label: "Overdue", cents: 12_600, tone: "danger" }),
        },
        {
            key: "muted",
            title: "Muted, nothing yet",
            props: () => ({ label: "Tips", cents: null, tone: "muted" }),
        },
    ],
});
