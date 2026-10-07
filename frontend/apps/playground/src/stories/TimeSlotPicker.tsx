import type { TimeSlotPickerProps } from "@clientbridge/app-core";

import { story } from "../story";

const GROUPS: TimeSlotPickerProps["groups"] = [
    {
        label: "Morning",
        slots: [
            { key: "09:00", label: "9:00" },
            { key: "09:30", label: "9:30", disabled: true },
            { key: "10:00", label: "10:00" },
            { key: "11:30", label: "11:30" },
        ],
    },
    {
        label: "Afternoon",
        slots: [
            { key: "13:00", label: "1:00" },
            { key: "14:30", label: "2:30", hint: "with Priya" },
            { key: "15:00", label: "3:00", disabled: true },
            { key: "16:30", label: "4:30" },
        ],
    },
];

export default story<TimeSlotPickerProps>({
    component: "TimeSlotPicker",
    summary:
        "Open times grouped by part of the day; a taken time stays visible but can't be picked.",
    controls: { columns: { type: "number", min: 3, max: 5 }, label: { type: "text" } },
    examples: [
        {
            key: "default",
            title: "Nothing picked",
            props: () => ({ groups: GROUPS, label: "Pick a time" }),
        },
        {
            key: "picked",
            title: "One picked",
            props: () => ({ groups: GROUPS, defaultValue: "14:30", label: "Pick a time" }),
        },
        {
            key: "controlled",
            title: "Controlled",
            state: { value: "value", onChange: "onChange" },
            props: () => ({ groups: GROUPS, value: "10:00", label: "Pick a time" }),
        },
        {
            key: "five",
            title: "Five across (four on mobile)",
            props: () => ({ groups: GROUPS, columns: 5, label: "Pick a time" }),
        },
        {
            key: "long-hint",
            title: "Long hints truncate",
            props: () => ({
                label: "Pick a time",
                groups: [
                    {
                        label: "Evening",
                        slots: [
                            { key: "17:00", label: "5:00", hint: "with Priya Ramaswamy-Okafor" },
                            { key: "17:30", label: "5:30", hint: "with Amélie Tremblay" },
                            { key: "18:00", label: "6:00", hint: "עם יעל כהן" },
                            { key: "18:30", label: "6:30", disabled: true },
                        ],
                    },
                ],
            }),
        },
        {
            key: "all-taken",
            title: "Every time taken",
            props: () => ({
                label: "Pick a time",
                groups: [
                    {
                        label: "Morning",
                        slots: GROUPS[0]?.slots.map((x) => ({ ...x, disabled: true })) ?? [],
                    },
                ],
            }),
        },
        {
            key: "three",
            title: "Three across",
            props: () => ({ groups: GROUPS, columns: 3, label: "Pick a time" }),
        },
    ],
});
