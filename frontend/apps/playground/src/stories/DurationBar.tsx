import type { DurationBarProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<DurationBarProps>({
    component: "DurationBar",
    summary: "How a booking blocks the calendar: buffers either side of the service itself.",
    controls: { caption: { type: "text" } },
    examples: [
        {
            key: "buffers",
            title: "With buffers",
            props: () => ({
                color: "#2E7A5A",
                caption: "Blocks 2 h 15 min: 15 min setup, 1 h 45 min groom, 15 min clean-up",
                segments: [
                    { key: "before", minutes: 15, label: "Setup", kind: "buffer" },
                    { key: "main", minutes: 105, label: "Full groom", kind: "main" },
                    { key: "after", minutes: 15, label: "Clean-up", kind: "buffer" },
                ],
            }),
        },
        {
            key: "plain",
            title: "No buffers, accent colour",
            props: () => ({
                segments: [{ key: "main", minutes: 30, label: "Nail trim", kind: "main" }],
            }),
        },
    ],
});
