import type { StarsProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

export default story<StarsProps>({
    component: "Stars",
    summary: "A rating to show, or five stars to pick from.",
    controls: {
        value: { type: "number", min: 0, max: 5 },
        size: { type: "select", options: ["sm", "md", "lg"] },
    },
    examples: [
        { key: "display", title: "Showing a rating", props: () => ({ value: 4 }) },
        { key: "small", title: "Small", props: () => ({ value: 5, size: "sm" }) },
        { key: "display-large", title: "Large", props: () => ({ value: 2, size: "lg" }) },
        {
            key: "pick",
            title: "Picking, large, controlled",
            state: { value: "value", onChange: "onSelect" },
            props: () => ({ value: 3, size: "lg", onSelect: noop }),
        },
        {
            key: "pick-medium",
            title: "Picking, medium, controlled",
            state: { value: "value", onChange: "onSelect" },
            props: () => ({ value: 5, onSelect: noop }),
        },
        {
            key: "pick-small",
            title: "Picking, small",
            state: { value: "value", onChange: "onSelect" },
            props: () => ({ value: 1, size: "sm", onSelect: noop }),
        },
        { key: "none", title: "No rating yet", props: () => ({ value: 0, onSelect: noop }) },
        { key: "zero", title: "Showing zero", props: () => ({ value: 0 }) },
    ],
});
