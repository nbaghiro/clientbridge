import type { ConversationRowProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

export default story<ConversationRowProps>({
    component: "ConversationRow",
    summary:
        "A conversation in the inbox list: who, the last message, the channel and unread count.",
    controls: {
        name: { type: "text" },
        unread: { type: "number", min: 0, max: 120 },
        channel: { type: "select", options: ["sms", "email", "chat"] },
        selected: { type: "boolean" },
    },
    examples: [
        {
            key: "unread",
            title: "Unread text",
            props: () => ({
                name: "Diego Ruiz",
                preview: "Can we move Friday to 3? Pepper has a vet visit.",
                at: "9:12 a.m.",
                unread: 2,
                channel: "sms",
                channelLabel: "Text",
                onPress: noop,
            }),
        },
        {
            key: "read",
            title: "Read email",
            props: () => ({
                name: "Amélie Tremblay",
                preview: "Thanks, see you Tuesday.",
                at: "Yesterday",
                unread: 0,
                channel: "email",
                channelLabel: "Email",
                onPress: noop,
            }),
        },
        {
            key: "selected",
            title: "Selected",
            props: () => ({
                name: "Grace Lin",
                preview: "Is there room for a nail trim today?",
                at: "Mon",
                unread: 0,
                channel: "chat",
                channelLabel: "Chat",
                selected: true,
                onPress: noop,
            }),
        },
        {
            key: "tag",
            title: "Opted out, unknown number",
            props: () => ({
                name: "+1 250 555 0144",
                preview: "STOP",
                at: "Sep 30",
                unread: 1,
                channel: "sms",
                channelLabel: "Text",
                tag: { label: "Opted out", intent: "danger" },
                onPress: noop,
            }),
        },
    ],
});
