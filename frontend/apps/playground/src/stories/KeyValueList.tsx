import type { KeyValueListProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<KeyValueListProps>({
    component: "KeyValueList",
    summary: "Labelled facts, one per line or stacked in a grid for narrow panels.",
    controls: {
        layout: { type: "select", options: ["inline", "stack"] },
        columns: { type: "number", min: 2, max: 4 },
    },
    examples: [
        {
            key: "inline",
            title: "Inline",
            props: () => ({
                rows: [
                    { label: "Client", value: "Amélie Tremblay" },
                    { label: "Pet", value: "Biscuit, golden retriever" },
                    { label: "Phone", value: "+1 250 555 0101" },
                    { label: "Balance", value: "$84.00", intent: "danger" },
                ],
            }),
        },
        {
            key: "stack",
            title: "Stacked, two columns",
            props: () => ({
                layout: "stack",
                rows: [
                    { label: "Visits", value: "14" },
                    { label: "Lifetime", value: "$2,145.92" },
                    { label: "Last visit", value: "Sep 22" },
                    { label: "Status", value: "Active", intent: "success" },
                ],
            }),
        },
        {
            key: "stack-four",
            title: "Stacked, four columns",
            props: (k) => ({
                layout: "stack",
                columns: 4,
                rows: [
                    { label: "Gross", value: <k.Money cents={482000} /> },
                    { label: "Fees", value: <k.Money cents={14100} tone="muted" /> },
                    { label: "Refunds", value: <k.Money cents={0} tone="muted" /> },
                    { label: "Net", value: <k.Money cents={467900} strong /> },
                ],
            }),
        },
        {
            key: "stack-three",
            title: "Stacked, three columns, every intent",
            props: () => ({
                layout: "stack",
                columns: 3,
                rows: [
                    { label: "Plan", value: "Studio", intent: "accent" },
                    { label: "Paid", value: "Yes", intent: "success" },
                    { label: "Card", value: "Expires soon", intent: "warning" },
                    { label: "Balance", value: "$84.00", intent: "danger" },
                    { label: "Notes", value: "None", intent: "neutral" },
                    { label: "Visits", value: "14" },
                ],
            }),
        },
        {
            key: "long",
            title: "Long labels and values",
            props: () => ({
                rows: [
                    {
                        label: "Preferred groomer for full grooms booked online",
                        value: "Hannah Lee, or the next available senior groomer",
                    },
                    {
                        label: "Email",
                        value: "maximiliana.featherstonehaugh-villanueva@longfamilyname.example.com",
                    },
                    {
                        label: "Notes",
                        value: "Nervous with the dryer; use the quiet setting, take breaks every ten minutes, and never use the muzzle.",
                    },
                ],
            }),
        },
        {
            key: "stack-long",
            title: "Stacked, long values",
            props: () => ({
                layout: "stack",
                rows: [
                    {
                        label: "Address",
                        value: "1148 Birch Bark Lane, Unit 2201, Victoria, British Columbia V8V 1A1",
                    },
                    { label: "Email", value: "amelie.tremblay-okonkwo@example.com" },
                ],
            }),
        },
        {
            key: "rtl",
            title: "Right-to-left",
            props: () => ({
                rows: [
                    { label: "العميل", value: "نور الهدى عبد الرحمن" },
                    { label: "الحيوان", value: "بسكويت" },
                    { label: "الرصيد", value: "٨٤٫٠٠ $", intent: "danger" },
                ],
            }),
        },
    ],
});
