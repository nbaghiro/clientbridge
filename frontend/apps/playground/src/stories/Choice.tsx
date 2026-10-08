import type { ChoiceProps } from "@clientbridge/app-core";

import { noop, story, toggleKey } from "../story";

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
        {
            key: "controlled",
            title: "Controlled, one value",
            state: { value: "value", onChange: "onChange" },
            props: () => ({ label: "Coat size", options: SIZES, value: "small", onChange: noop }),
        },
        {
            key: "controlled-many",
            title: "Controlled, several values",
            state: { value: "value", onChange: "onChange", reduce: toggleKey },
            props: () => ({
                label: "Days",
                options: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => ({
                    key: d,
                    label: d,
                })),
                value: ["Tue", "Thu"],
                onChange: noop,
            }),
        },
        {
            key: "none",
            title: "Nothing chosen",
            props: () => ({ label: "Coat size", options: SIZES, defaultValue: null }),
        },
        {
            key: "segmented-disabled",
            title: "Segmented, one option disabled",
            props: () => ({
                label: "View",
                layout: "segmented",
                options: [
                    { key: "day", label: "Day" },
                    { key: "week", label: "Week" },
                    { key: "month", label: "Month", disabled: true },
                ],
                defaultValue: "day",
            }),
        },
        {
            key: "cards-disabled",
            title: "Cards, one disabled",
            props: () => ({
                label: "Deposit",
                layout: "cards",
                options: [
                    { key: "none", label: "No deposit", hint: "Clients pay at the visit" },
                    { key: "flat", label: "Flat amount", hint: "$20 when they book" },
                    {
                        key: "percent",
                        label: "Percentage",
                        hint: "Complete payment verification first",
                        disabled: true,
                    },
                ],
                defaultValue: "flat",
            }),
        },
        {
            key: "tiles-five",
            title: "Tiles, five across with one disabled",
            props: () => ({
                label: "Duration",
                layout: "tiles",
                columns: 5,
                options: ["15", "30", "45", "60", "90"].map((m) => ({
                    key: m,
                    label: `${m} min`,
                    disabled: m === "90",
                })),
                defaultValue: "45",
            }),
        },
        {
            key: "tiles-two",
            title: "Tiles, two across with details",
            props: () => ({
                label: "Who pays",
                layout: "tiles",
                columns: 2,
                options: [
                    {
                        key: "client",
                        label: "The client",
                        hint: "Charged at checkout",
                        detail: "Card on file or a new card",
                    },
                    {
                        key: "business",
                        label: "The business",
                        hint: "Absorbed as a fee",
                        detail: "Shows on the payout report",
                    },
                ],
                defaultValue: "client",
            }),
        },
        {
            key: "long",
            title: "Long labels and right-to-left text",
            props: () => ({
                label: "Groomer",
                options: [
                    {
                        key: "a",
                        label: "Bartholomew Featherstonehaugh-Montgomery",
                        hint: "Senior groomer, large breeds and hand-stripping",
                    },
                    { key: "b", label: "ليلى حداد", hint: "נועה כהן" },
                    { key: "c", label: "Any available groomer" },
                ],
                defaultValue: "b",
            }),
        },
        {
            key: "long-cards",
            title: "Long labels as cards",
            props: () => ({
                label: "Groomer",
                layout: "cards",
                options: [
                    {
                        key: "a",
                        label: "Bartholomew Featherstonehaugh-Montgomery",
                        hint: "Senior groomer, large breeds and hand-stripping, Tuesday to Saturday",
                    },
                    { key: "b", label: "ليلى حداد", hint: "נועה כהן" },
                ],
                defaultValue: "a",
            }),
        },
    ],
});
