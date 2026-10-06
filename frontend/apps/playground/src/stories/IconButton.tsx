import type { IconButtonProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

export default story<IconButtonProps>({
    component: "IconButton",
    summary:
        "A square button with only a glyph, an accessible label, and an optional count or dot.",
    controls: {
        label: { type: "text" },
        variant: { type: "select", options: ["quiet", "outline"] },
        size: { type: "select", options: ["sm", "md"] },
        pressed: { type: "boolean" },
        disabled: { type: "boolean" },
    },
    examples: [
        {
            key: "quiet",
            title: "Quiet",
            props: () => ({ icon: "settings", label: "Settings", onPress: noop }),
        },
        {
            key: "outline",
            title: "Outline",
            props: () => ({ icon: "filter", label: "Filter", variant: "outline", onPress: noop }),
        },
        {
            key: "small",
            title: "Small",
            props: () => ({ icon: "more", label: "More actions", size: "sm", onPress: noop }),
        },
        {
            key: "count",
            title: "With a count",
            props: () => ({ icon: "bell", label: "Notifications", badge: 4, onPress: noop }),
        },
        {
            key: "many",
            title: "Count over 99",
            props: () => ({ icon: "inbox", label: "Inbox", badge: 140, onPress: noop }),
        },
        {
            key: "dot",
            title: "With a dot",
            props: () => ({ icon: "bell", label: "Notifications", badge: true, onPress: noop }),
        },
        {
            key: "pressed",
            title: "Pressed",
            props: () => ({
                icon: "panelLeft",
                label: "Show sidebar",
                pressed: true,
                onPress: noop,
            }),
        },
        {
            key: "disabled",
            title: "Disabled",
            props: () => ({ icon: "trash", label: "Delete", disabled: true, onPress: noop }),
        },
    ],
});
