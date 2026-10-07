import type { StatProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<StatProps>({
    component: "Stat",
    summary: "A labelled figure, money or text, large on Today and smaller in Reports.",
    controls: {
        label: { type: "text" },
        size: { type: "select", options: ["md", "lg"] },
        tone: { type: "select", options: ["ink", "muted", "success", "warning", "danger"] },
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
            key: "warning",
            title: "Warning",
            props: () => ({
                label: "Low stock",
                value: "4",
                tone: "warning",
                hint: "items at or under their low line",
            }),
        },
        {
            key: "danger",
            title: "Danger",
            props: () => ({ label: "Overdue", cents: 12_600, tone: "danger" }),
        },
        {
            key: "muted",
            title: "Muted",
            props: () => ({ label: "Tips", cents: 0, tone: "muted", hint: "none yet" }),
        },
        {
            key: "loading",
            title: "Loading (no figure yet)",
            props: () => ({ label: "Tips", cents: null }),
        },
        {
            key: "loading-large",
            title: "Loading, large",
            props: () => ({ label: "Awaiting payment", cents: null, size: "lg" }),
        },
        {
            key: "large-success",
            title: "Large, success with a text value",
            props: () => ({
                label: "Rebooked before leaving",
                value: "86%",
                tone: "success",
                size: "lg",
            }),
        },
        {
            key: "long",
            title: "Long label and hint",
            props: () => ({
                label: "Deposits collected for upcoming bookings in the next thirty days",
                cents: 1_234_500,
                hint: "includes deposits on recurring visits and class packages bought online",
            }),
        },
        {
            key: "rtl",
            title: "Hebrew label",
            props: () => ({ label: "הכנסות היום", cents: 48_400, hint: "התקבל היום" }),
        },
    ],
});
