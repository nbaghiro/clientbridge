import type { CopyFieldProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<CopyFieldProps>({
    component: "CopyField",
    summary: "A link, snippet or reference to hand out, with a copy button that confirms in place.",
    controls: {
        label: { type: "text" },
        variant: { type: "select", options: ["line", "snippet", "code"] },
        value: { type: "text" },
        hint: { type: "text" },
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
            key: "snippet-long",
            title: "Long embed snippet wraps at spaces",
            props: () => ({
                label: "Add to your website",
                variant: "snippet",
                value: '<iframe src="https://book.clientbridge.app/book/birchbark?embed=1&theme=pewter" title="Book with Birchbark Pet Studio" width="100%" height="720" style="border:0" loading="lazy"></iframe>\n<a href="https://book.clientbridge.app/book/birchbark">Book a visit</a>',
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
            title: "Copied, held by the parent",
            props: () => ({
                label: "Pay link",
                value: "https://book.clientbridge.app/pay/x7Hq",
                copied: true,
            }),
        },
        {
            key: "controlled",
            title: "Controlled (copy flips to Copied)",
            state: { value: "copied", onChange: "onCopy", reduce: () => true },
            props: () => ({
                label: "Gift card code",
                variant: "code",
                value: "GC-7Q4M-2KXP",
                copied: false,
                copyLabel: "Copy code",
                copiedLabel: "Code copied",
            }),
        },
        {
            key: "long",
            title: "Long link, no hint",
            props: () => ({
                label: "Intake form for new clients who book a first full groom online",
                value: "https://book.clientbridge.app/forms/birchbark/new-client-intake-and-vaccination-record?ref=instagram-bio&utm_campaign=autumn",
            }),
        },
        {
            key: "rtl",
            title: "Right-to-left label",
            props: () => ({
                label: "رابط الحجز",
                value: "https://book.clientbridge.app/book/birchbark",
                hint: "شارك هذا الرابط مع عملائك.",
            }),
        },
    ],
});
