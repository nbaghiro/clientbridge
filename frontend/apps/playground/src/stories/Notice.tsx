import type { NoticeProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<NoticeProps>({
    component: "Notice",
    summary: "A danger, success or info line under a form, or the same message in a filled box.",
    controls: {
        tone: { type: "select", options: ["danger", "success", "info"] },
        banner: { type: "boolean" },
        children: { type: "text" },
    },
    examples: [
        {
            key: "danger",
            title: "Danger line",
            props: () => ({ tone: "danger", children: "That email is already in use." }),
        },
        {
            key: "success",
            title: "Success line",
            props: () => ({ tone: "success", children: "Saved." }),
        },
        {
            key: "info",
            title: "Info line",
            props: () => ({ tone: "info", children: "Clients see this on their receipt." }),
        },
        {
            key: "danger-banner",
            title: "Danger box",
            props: () => ({
                tone: "danger",
                banner: true,
                children: "The card was declined. Try another card.",
            }),
        },
        {
            key: "success-banner",
            title: "Success box",
            props: () => ({
                tone: "success",
                banner: true,
                children: "Payouts are on. The first arrives Friday.",
            }),
        },
        {
            key: "info-banner",
            title: "Info box",
            props: () => ({
                tone: "info",
                banner: true,
                children: "This shop isn't taking online payments right now.",
            }),
        },
    ],
});
