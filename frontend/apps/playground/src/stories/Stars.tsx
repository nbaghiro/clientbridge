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
        {
            key: "pick",
            title: "Picking, large",
            props: () => ({ value: 3, size: "lg", onSelect: noop }),
        },
        { key: "none", title: "No rating yet", props: () => ({ value: 0, onSelect: noop }) },
    ],
});
