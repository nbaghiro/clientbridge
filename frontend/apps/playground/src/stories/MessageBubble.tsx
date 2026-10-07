import type { MessageBubbleProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<MessageBubbleProps>({
    component: "MessageBubble",
    summary: "One line of a conversation, in or out, a failed send, or a centred system event.",
    controls: {
        body: { type: "text" },
        meta: { type: "text" },
        direction: { type: "select", options: ["in", "out"] },
        variant: { type: "select", options: ["message", "event"] },
        width: { type: "select", options: ["auto", "full"] },
        failed: { type: "boolean" },
    },
    examples: [
        {
            key: "in",
            title: "Incoming",
            props: () => ({
                body: "Hi! Can Biscuit come in Thursday instead of Friday?",
                direction: "in",
                meta: "9:12 a.m.",
            }),
        },
        {
            key: "out",
            title: "Outgoing",
            props: () => ({
                body: "Thursday at 2:30 works. See you then.",
                direction: "out",
                meta: "9:14 a.m. · Hannah · Delivered",
            }),
        },
        {
            key: "failed",
            title: "Failed to send",
            props: () => ({
                body: "Your invoice for $84.00 is ready.",
                direction: "out",
                failed: true,
                meta: "Not delivered · Tap to retry",
            }),
        },
        {
            key: "event",
            title: "System event",
            props: () => ({
                body: "Diego Ruiz opted out of text messages",
                direction: "in",
                variant: "event",
            }),
        },
        {
            key: "full",
            title: "Full width",
            props: () => ({
                body: "Reminder: Mochi's bath and tidy is tomorrow at 10:00 a.m. Reply C to confirm.",
                direction: "out",
                width: "full",
            }),
        },
        {
            key: "multiline",
            title: "Line breaks",
            props: () => ({
                body: "Biscuit: full groom\nMochi: bath and tidy\nTotal: $140.00",
                direction: "out",
                meta: "Yesterday",
            }),
        },
        {
            key: "link",
            title: "A long link",
            props: () => ({
                body: "Pay here: https://pay.clientbridge.ca/i/inv_1148_9f8e7d6c5b4a39281706f5e4d3c2b1a0",
                direction: "out",
                meta: "9:20 a.m.",
            }),
        },
        {
            key: "long-in",
            title: "Long incoming",
            props: () => ({
                body: "Hello, I wanted to ask whether you could also trim around the eyes and paws this time, and whether the de-shedding treatment is worth it for a double coat in the fall. Thanks so much for last time.",
                direction: "in",
                meta: "Sun 8:41 p.m.",
            }),
        },
        {
            key: "rtl",
            title: "Right-to-left",
            props: () => ({
                body: "مرحبا، هل يمكن أن يأتي بسكويت يوم الخميس بدلا من الجمعة؟",
                direction: "in",
                meta: "9:12 a.m.",
            }),
        },
        {
            key: "event-long",
            title: "Long system event",
            props: () => ({
                body: "Messages from +1 250 555 0199 now go to Hannah Lee because Priya Shah is away until Monday",
                direction: "in",
                variant: "event",
            }),
        },
    ],
});
