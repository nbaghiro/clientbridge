import type { BadgeProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<BadgeProps>({
    component: "Badge",
    summary: "A short label as a pill coloured by intent, or a count.",
    controls: {
        label: { type: "text" },
        intent: { type: "select", options: ["accent", "success", "warning", "danger", "neutral"] },
        variant: { type: "select", options: ["pill", "count"] },
    },
    examples: [
        { key: "accent", title: "Accent", props: () => ({ label: "Default" }) },
        { key: "success", title: "Success", props: () => ({ label: "Paid", intent: "success" }) },
        {
            key: "warning",
            title: "Warning",
            props: () => ({ label: "Low stock", intent: "warning" }),
        },
        { key: "danger", title: "Danger", props: () => ({ label: "Opted out", intent: "danger" }) },
        { key: "neutral", title: "Neutral", props: () => ({ label: "Refund", intent: "neutral" }) },
        { key: "count", title: "Count", props: () => ({ label: 3, variant: "count" }) },
    ],
});
