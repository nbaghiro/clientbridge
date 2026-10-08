import type { SlotChipsProps } from "@clientbridge/app-core";
import { story } from "../story";
export default story<SlotChipsProps>({
    component: "SlotChips",
    summary: "Client-facing choices and actions for Connect.",
    controls: {
        layout: { type: "select", options: ["grid", "rail", "stack"] },
        size: { type: "select", options: ["md", "lg"] },
    },
    examples: [
        ...(["grid", "rail", "stack"] as const).map((layout) => ({
            key: layout,
            title: layout,
            state: { value: "value", onChange: "onChange" },
            props: () => ({
                label: "Choose a time",
                layout,
                value: "10",
                groups: [
                    {
                        label: "Morning",
                        slots: [
                            { key: "9", label: "9:00", disabled: true },
                            { key: "10", label: "10:00" },
                            { key: "11", label: "11:00", hint: "With Priya" },
                        ],
                    },
                ],
            }),
        })),
    ],
});
