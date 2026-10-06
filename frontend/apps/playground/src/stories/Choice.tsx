import type { ChoiceProps } from "@clientbridge/app-core";

import { story } from "../story";

const SIZES = [
    { key: "small", label: "Small", hint: "Under 10 kg" },
    { key: "medium", label: "Medium", hint: "10 to 25 kg" },
    { key: "large", label: "Large", hint: "Over 25 kg" },
];

export default story<ChoiceProps<string>>({
    component: "Choice",
    summary: "Chips, a segmented control, option cards or tiles, for one value or several.",
    controls: {
        layout: { type: "select", options: ["chips", "segmented", "cards", "tiles"] },
        size: { type: "select", options: ["md", "lg"] },
        columns: { type: "number", min: 2, max: 5 },
        label: { type: "text" },
    },
    examples: [
        {
            key: "chips",
            title: "Chips",
            props: () => ({ label: "Coat size", options: SIZES, defaultValue: "medium" }),
        },
        {
            key: "chips-many",
            title: "Chips, several chosen",
            props: () => ({
                label: "Add-ons",
                options: [
                    { key: "nails", label: "Nail trim" },
                    { key: "teeth", label: "Teeth" },
                    { key: "ears", label: "Ear clean" },
                    { key: "bow", label: "Bow", disabled: true },
                ],
                defaultValue: ["nails", "ears"],
            }),
        },
        {
            key: "segmented",
            title: "Segmented",
            props: () => ({
                label: "View",
                layout: "segmented",
                options: [
                    { key: "day", label: "Day" },
                    { key: "week", label: "Week" },
                    { key: "month", label: "Month" },
                ],
                defaultValue: "week",
            }),
        },
        {
            key: "cards",
            title: "Cards with hints",
            props: () => ({
                label: "Coat size",
                layout: "cards",
                options: SIZES,
                defaultValue: "large",
            }),
        },
        {
            key: "tiles",
            title: "Tiles",
            props: () => ({
                label: "Payment",
                layout: "tiles",
                columns: 3,
                options: [
                    { key: "card", label: "Card", detail: "Tap, insert or swipe" },
                    { key: "cash", label: "Cash" },
                    { key: "interac", label: "e-Transfer", detail: "Reference shown after" },
                ],
                defaultValue: "card",
            }),
        },
        {
            key: "tiles-large",
            title: "Tiles, large (tips)",
            props: () => ({
                label: "Add a tip",
                layout: "tiles",
                size: "lg",
                columns: 4,
                options: [
                    { key: "15", label: "15%", hint: "$12.60" },
                    { key: "18", label: "18%", hint: "$15.12" },
                    { key: "20", label: "20%", hint: "$16.80" },
                    { key: "none", label: "None" },
                ],
                defaultValue: "18",
            }),
        },
    ],
});
