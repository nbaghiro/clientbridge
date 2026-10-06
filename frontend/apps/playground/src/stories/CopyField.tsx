import type { CopyFieldProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<CopyFieldProps>({
    component: "CopyField",
    summary: "A link, snippet or reference to hand out, with a copy button that confirms in place.",
    controls: {
        label: { type: "text" },
        variant: { type: "select", options: ["line", "snippet", "code"] },
        copied: { type: "boolean" },
    },
    examples: [
        {
            key: "line",
            title: "Link",
            props: () => ({
                label: "Booking page",
                value: "https://book.clientbridge.app/book/birchbark",
                hint: "Share it on Instagram or your website.",
            }),
        },
        {
            key: "snippet",
            title: "Embed snippet",
            props: () => ({
                label: "Embed code",
                variant: "snippet",
                value: '<script src="https://book.clientbridge.app/embed.js" async></script>\n<connect-booking business="birchbark"></connect-booking>',
            }),
        },
        {
            key: "code",
            title: "e-Transfer reference",
            props: () => ({
                label: "Reference",
                variant: "code",
                value: "BB-1148",
                hint: "Type this in the message field.",
            }),
        },
        {
            key: "copied",
            title: "Copied (controlled)",
            props: () => ({
                label: "Pay link",
                value: "https://book.clientbridge.app/pay/x7Hq",
                copied: true,
            }),
        },
    ],
});
