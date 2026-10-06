import type { LineItemProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

export default story<LineItemProps>({
    component: "LineItem",
    summary:
        "One row of a sale or order, with quantity, a struck-through price when discounted, and remove.",
    controls: { title: { type: "text" }, meta: { type: "text" }, selected: { type: "boolean" } },
    examples: [
        {
            key: "plain",
            title: "Plain",
            props: () => ({ title: "Full groom", meta: "Biscuit · Hannah", cents: 8500 }),
        },
        {
            key: "stepper",
            title: "With a quantity stepper",
            props: () => ({
                title: "Oatmeal shampoo (500ml)",
                cents: 4800,
                quantity: { value: 2, onChange: noop, label: "Oatmeal shampoo" },
                onRemove: noop,
            }),
        },
        {
            key: "count",
            title: "Read-only count",
            props: () => ({ title: "Nail trim", cents: 4000, count: 2 }),
        },
        {
            key: "discount",
            title: "Discounted with a tag",
            props: () => ({
                title: "Blueberry facial",
                cents: 1350,
                originalCents: 1500,
                tag: { label: "10% loyalty", intent: "success" },
                meta: "Biscuit",
            }),
        },
        {
            key: "leading",
            title: "Leading slot and press",
            props: (k) => ({
                title: "Full groom",
                meta: "Diego Ruiz",
                leading: <k.Avatar name="Diego Ruiz" size="sm" />,
                cents: 8500,
                onPress: noop,
                pressLabel: "Edit full groom",
            }),
        },
        {
            key: "selected",
            title: "Selected",
            props: () => ({ title: "Bath and tidy", cents: 5500, selected: true, onRemove: noop }),
        },
    ],
});
