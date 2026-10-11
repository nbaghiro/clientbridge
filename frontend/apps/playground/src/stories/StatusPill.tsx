import type { StatusPillProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<StatusPillProps>({
    component: "StatusPill",
    summary: "A record's status, coloured from the shared intent palette.",
    controls: {
        status: { type: "text" },
        intent: { type: "select", options: ["accent", "success", "warning", "danger", "neutral"] },
    },
    examples: [
        { key: "paid", title: "Success", props: () => ({ status: "Paid", intent: "success" }) },
        { key: "sent", title: "Accent", props: () => ({ status: "Sent", intent: "accent" }) },
        {
            key: "pending",
            title: "Warning",
            props: () => ({ status: "Past due", intent: "warning" }),
        },
        { key: "overdue", title: "Danger", props: () => ({ status: "Overdue", intent: "danger" }) },
        { key: "draft", title: "Neutral", props: () => ({ status: "Draft", intent: "neutral" }) },
        {
            key: "long",
            title: "Long label",
            props: () => ({
                status: "Waiting for the client to sign the updated grooming agreement",
                intent: "warning",
            }),
        },
        {
            key: "rtl",
            title: "Arabic label",
            props: () => ({ status: "مدفوع", intent: "success" }),
        },
    ],
});
