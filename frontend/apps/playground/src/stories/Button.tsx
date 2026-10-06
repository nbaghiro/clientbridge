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
        disabled: { type: "boolean" },
        busy: { type: "boolean" },
        full: { type: "boolean" },
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
            key: "small",
            title: "Small",
            props: () => ({ children: "Edit", size: "sm", variant: "outline", onPress: noop }),
        },
        {
            key: "large",
            title: "Large, full width",
            props: () => ({ children: "Pay $84.00", size: "lg", full: true, onPress: noop }),
        },
        { key: "busy", title: "Busy", props: () => ({ children: "Saving…", busy: true }) },
        { key: "disabled", title: "Disabled", props: () => ({ children: "Send", disabled: true }) },
    ],
});
