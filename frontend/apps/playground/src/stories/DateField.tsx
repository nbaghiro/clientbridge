import type { DateFieldProps, DateTimeFieldProps, TimeFieldProps } from "@clientbridge/app-core";

import { story } from "../story";

export default [
    story<DateFieldProps>({
        component: "DateField",
        summary:
            "A field that opens a month calendar: arrow keys move by day and week, Page Up and Down by month, and the title jumps to a year.",
        controls: {
            label: { type: "text" },
            hint: { type: "text" },
            error: { type: "text" },
            placeholder: { type: "text" },
            min: { type: "text" },
            max: { type: "text" },
            size: { type: "select", options: ["sm", "md", "lg"] },
            required: { type: "boolean" },
            disabled: { type: "boolean" },
        },
        examples: [
            {
                key: "date",
                title: "Default",
                props: () => ({ label: "Date", defaultValue: "2026-10-08" }),
            },
            {
                key: "date-empty",
                title: "Empty with a placeholder",
                props: () => ({
                    label: "First visit",
                    placeholder: "Pick a day",
                    defaultValue: "",
                }),
            },
            {
                key: "date-bounds",
                title: "Within a range",
                props: () => ({
                    label: "Paid on",
                    hint: "Only days in the last two weeks can be picked.",
                    defaultValue: "2026-10-05",
                    min: "2026-09-24",
                    max: "2026-10-07",
                }),
            },
            {
                key: "date-past",
                title: "Far in the past, optional",
                props: () => ({ label: "Birthday", optional: true, defaultValue: "2019-04-12" }),
            },
            {
                key: "date-error",
                title: "Error",
                props: () => ({
                    label: "Ends on",
                    required: true,
                    defaultValue: "2026-09-30",
                    error: "Pick a day after the start.",
                }),
            },
            {
                key: "date-disabled",
                title: "Disabled",
                props: () => ({ label: "Starts on", disabled: true, defaultValue: "2026-10-01" }),
            },
            {
                key: "date-controlled",
                title: "Controlled",
                state: { value: "value", onChange: "onChange" },
                props: () => ({ label: "Day", value: "2026-12-24" }),
            },
            {
                key: "date-small",
                title: "Small, no label",
                props: () => ({
                    name: "Day",
                    size: "sm",
                    width: "auto",
                    defaultValue: "2026-10-08",
                }),
            },
        ],
    }),
    story<TimeFieldProps>({
        component: "TimeField",
        summary: "A list of times at a fixed step, searchable by typing, in the Select's look.",
        controls: {
            label: { type: "text" },
            step: { type: "number", min: 5, max: 60, step: 5 },
            min: { type: "text" },
            max: { type: "text" },
            disabled: { type: "boolean" },
        },
        examples: [
            {
                key: "time",
                title: "Default",
                props: () => ({ label: "Start", defaultValue: "09:30" }),
            },
            {
                key: "time-hours",
                title: "Business hours, every 30 minutes",
                props: () => ({
                    label: "Opens",
                    step: 30,
                    min: "06:00",
                    max: "21:00",
                    defaultValue: "",
                }),
            },
            {
                key: "time-off-step",
                title: "A time between steps",
                props: () => ({ label: "Drop-off", defaultValue: "10:07" }),
            },
            {
                key: "time-error",
                title: "Error",
                props: () => ({
                    label: "Ends",
                    defaultValue: "08:00",
                    error: "Pick a time after the start.",
                }),
            },
        ],
    }),
    story<DateTimeFieldProps>({
        component: "DateTimeField",
        summary: "A day and a time side by side, for one moment such as a scheduled send.",
        controls: {
            label: { type: "text" },
            hint: { type: "text" },
            error: { type: "text" },
            disabled: { type: "boolean" },
        },
        examples: [
            {
                key: "datetime",
                title: "Default",
                props: () => ({ label: "Send at", defaultValue: "2026-10-09T10:00" }),
            },
            {
                key: "datetime-empty",
                title: "Empty, from today",
                props: () => ({
                    label: "Send at",
                    min: "2026-10-07",
                    hint: "Clients in other time zones get it at this local time.",
                    defaultValue: "",
                }),
            },
            {
                key: "datetime-error",
                title: "Error",
                props: () => ({
                    label: "Send at",
                    defaultValue: "2026-10-01T08:00",
                    error: "Pick a time in the future.",
                }),
            },
        ],
    }),
];
