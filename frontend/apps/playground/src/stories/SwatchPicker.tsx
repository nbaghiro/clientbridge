import type { SwatchPickerProps } from "@clientbridge/app-core";

import { story } from "../story";

const COLOURS = [
    "#3F5E80",
    "#2E7A5A",
    "#B4562A",
    "#86621E",
    "#7A4E8C",
    "#A2433A",
    "#2F7F8A",
    "#5B6470",
];

export default story<SwatchPickerProps>({
    component: "SwatchPicker",
    summary: "Pick one colour for a service or a staff member.",
    controls: { label: { type: "text" } },
    examples: [
        {
            key: "default",
            title: "One chosen",
            props: () => ({ label: "Service colour", colours: COLOURS, defaultValue: "#2E7A5A" }),
        },
        {
            key: "none",
            title: "Nothing chosen",
            props: () => ({ label: "Staff colour", colours: COLOURS }),
        },
        {
            key: "controlled",
            title: "Controlled",
            state: { value: "value", onChange: "onChange" },
            props: () => ({ label: "Pet colour", colours: COLOURS, value: "#7A4E8C" }),
        },
        {
            key: "many",
            title: "Many colours wrap",
            props: () => ({
                label: "Service colour",
                colours: [
                    ...COLOURS,
                    "#C0392B",
                    "#16A085",
                    "#8E44AD",
                    "#D35400",
                    "#2C3E50",
                    "#7F8C8D",
                    "#27AE60",
                    "#F39C12",
                ],
                defaultValue: "#16A085",
            }),
        },
        {
            key: "few",
            title: "Short list",
            props: () => ({
                label: "Calendar colour",
                colours: COLOURS.slice(0, 3),
                defaultValue: "#3F5E80",
            }),
        },
    ],
});
