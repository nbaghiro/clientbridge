import type { ButtonProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

export default story<ButtonProps>({
    component: "Button",
    summary:
        "Primary, outline, quiet, danger and link buttons in three sizes, with an icon and a busy state.",
    controls: {
        children: { type: "text" },
        variant: { type: "select", options: ["primary", "outline", "quiet", "danger", "link"] },
        size: { type: "select", options: ["sm", "md", "lg"] },
        icon: { type: "select", options: ["plus", "check", "calendar", "send", "trash"] },
        label: { type: "text" },
        disabled: { type: "boolean" },
        busy: { type: "boolean" },
        full: { type: "boolean" },
        grow: { type: "boolean" },
    },
    examples: [
        {
            key: "primary",
            title: "Primary",
            props: () => ({ children: "Save changes", onPress: noop }),
        },
        {
            key: "outline",
            title: "Outline",
            props: () => ({ children: "Cancel", variant: "outline", onPress: noop }),
        },
        {
            key: "quiet",
            title: "Quiet",
            props: () => ({ children: "Skip", variant: "quiet", onPress: noop }),
        },
        {
            key: "danger",
            title: "Danger",
            props: () => ({ children: "Void invoice", variant: "danger", onPress: noop }),
        },
        {
            key: "link",
            title: "Link",
            props: () => ({ children: "View all", variant: "link", onPress: noop }),
        },
        {
            key: "icon",
            title: "With a glyph",
            props: () => ({ children: "New booking", icon: "plus", onPress: noop }),
        },
        {
            key: "icon-outline",
            title: "Outline with a glyph",
            props: () => ({
                children: "Send reminder",
                icon: "send",
                variant: "outline",
                onPress: noop,
            }),
        },
        {
            key: "icon-element",
            title: "With an element as the glyph",
            props: (k) => ({
                children: "Pay with Visa",
                icon: <k.Badge label="4242" intent="neutral" />,
                variant: "outline",
                onPress: noop,
            }),
        },
        {
            key: "small",
            title: "Small",
            props: () => ({ children: "Edit", size: "sm", variant: "outline", onPress: noop }),
        },
        {
            key: "medium",
            title: "Medium",
            props: () => ({ children: "Edit", size: "md", variant: "outline", onPress: noop }),
        },
        {
            key: "large",
            title: "Large, full width",
            props: () => ({ children: "Pay $84.00", size: "lg", full: true, onPress: noop }),
        },
        {
            key: "grow",
            title: "Growing to share a row",
            props: () => ({ children: "Check out", grow: true, onPress: noop, icon: "check" }),
        },
        { key: "busy", title: "Busy", props: () => ({ children: "Saving…", busy: true }) },
        {
            key: "busy-outline",
            title: "Busy, outline",
            props: () => ({ children: "Sending…", busy: true, variant: "outline" }),
        },
        { key: "disabled", title: "Disabled", props: () => ({ children: "Send", disabled: true }) },
        {
            key: "disabled-danger",
            title: "Disabled, danger",
            props: () => ({ children: "Refund", variant: "danger", disabled: true }),
        },
        {
            key: "disabled-link",
            title: "Disabled, link",
            props: () => ({ children: "Resend", variant: "link", disabled: true }),
        },
        {
            key: "accessible-name",
            title: "Accessible name differs from the text",
            props: () => ({
                children: "Pay",
                label: "Pay invoice 1148 for $84.00",
                onPress: noop,
            }),
        },
        {
            key: "long",
            title: "Long text",
            props: () => ({
                children:
                    "Send the updated grooming agreement to Bartholomew Featherstonehaugh-Montgomery",
                variant: "outline",
                onPress: noop,
            }),
        },
        {
            key: "rtl",
            title: "Right-to-left text",
            props: () => ({ children: "احجز موعدًا · קבע תור", icon: "calendar", onPress: noop }),
        },
    ],
});
