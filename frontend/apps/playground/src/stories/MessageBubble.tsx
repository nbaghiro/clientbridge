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
    ],
});
