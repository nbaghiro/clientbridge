import type { StatusPillProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<StatusPillProps>({
    component: "StatusPill",
    summary: "A record's status, coloured from the shared intent palette.",
    controls: {
        status: { type: "text" },
        intent: { type: "select", options: ["accent", "success", "warning", "danger", "neutral"] },
        asWritten: { type: "boolean" },
    },
    examples: [
        { key: "paid", title: "Success", props: () => ({ status: "paid", intent: "success" }) },
        { key: "sent", title: "Accent", props: () => ({ status: "sent", intent: "accent" }) },
        {
            key: "pending",
            title: "Warning",
            props: () => ({ status: "pending", intent: "warning" }),
        },
        { key: "overdue", title: "Danger", props: () => ({ status: "overdue", intent: "danger" }) },
        { key: "draft", title: "Neutral", props: () => ({ status: "draft", intent: "neutral" }) },
        {
            key: "as-written",
            title: "As written",
            props: () => ({ status: "Checked in", intent: "accent", asWritten: true }),
        },
        {
            key: "raw-snake",
            title: "Raw value, capitalized",
            props: () => ({ status: "partially refunded", intent: "warning" }),
        },
        {
            key: "long",
            title: "Long label",
            props: () => ({
                status: "Waiting for the client to sign the updated grooming agreement",
                intent: "warning",
                asWritten: true,
            }),
        },
        {
            key: "rtl",
            title: "Arabic label",
            props: () => ({ status: "مدفوع", intent: "success", asWritten: true }),
        },
    ],
});
