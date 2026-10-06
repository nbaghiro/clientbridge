import type { MeterProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<MeterProps>({
    component: "Meter",
    summary: "How much of something: a balance used, seats booked, stock against its low line.",
    controls: {
        value: { type: "number", min: 0, max: 20 },
        max: { type: "number", min: 1, max: 20 },
        label: { type: "text" },
        detail: { type: "text" },
        intent: { type: "select", options: ["accent", "success", "warning", "danger", "neutral"] },
        labelPosition: { type: "select", options: ["above", "below", "beside", "hidden"] },
        size: { type: "select", options: ["sm", "md"] },
        units: { type: "boolean" },
    },
    examples: [
        {
            key: "above",
            title: "Label above",
            props: () => ({ value: 6, max: 10, label: "Groom package", detail: "6 of 10 used" }),
        },
        {
            key: "below",
            title: "Label below",
            props: () => ({
                value: 3,
                max: 10,
                label: "3 of 10 left",
                labelPosition: "below",
                intent: "warning",
            }),
        },
        {
            key: "beside",
            title: "Label beside",
            props: () => ({
                value: 9,
                max: 10,
                label: "Almost full",
                labelPosition: "beside",
                intent: "danger",
            }),
        },
        {
            key: "hidden",
            title: "Label hidden",
            props: () => ({
                value: 40,
                max: 100,
                label: "Gift card used",
                labelPosition: "hidden",
                size: "sm",
            }),
        },
        {
            key: "units",
            title: "Seats",
            props: () => ({
                value: 5,
                max: 8,
                label: "Puppy class",
                detail: "5 of 8 booked",
                units: true,
            }),
        },
        {
            key: "waitlist",
            title: "Seats with a waitlist",
            props: () => ({
                value: 8,
                max: 8,
                overflow: 2,
                label: "Puppy class",
                detail: "Full, 2 waiting",
                units: true,
                intent: "success",
            }),
        },
        {
            key: "marker",
            title: "Stock with a low line",
            props: () => ({
                value: 3,
                max: 24,
                marker: 5,
                label: "Oatmeal shampoo",
                detail: "3 in stock, reorder at 5",
                intent: "warning",
            }),
        },
        {
            key: "empty",
            title: "Empty",
            props: () => ({ value: 0, max: 10, label: "Nothing used yet" }),
        },
    ],
});
