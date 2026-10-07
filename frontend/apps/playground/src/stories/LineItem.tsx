import type { LineItemProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

export default story<LineItemProps>({
    component: "LineItem",
    summary:
        "One row of a sale or order, with quantity, a struck-through price when discounted, and remove.",
    controls: {
        title: { type: "text" },
        meta: { type: "text" },
        cents: { type: "number", step: 100 },
        count: { type: "number", min: 0, max: 20 },
        selected: { type: "boolean" },
    },
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
                removeLabel: "Remove oatmeal shampoo",
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
            props: () => ({
                title: "Bath and tidy",
                cents: 5500,
                selected: true,
                onRemove: noop,
                removeLabel: "Remove bath and tidy",
            }),
        },
        {
            key: "tag-warning",
            title: "Warning tag",
            props: () => ({
                title: "Oatmeal shampoo (500ml)",
                cents: 1600,
                tag: { label: "Last one", intent: "warning" },
                count: 1,
            }),
        },
        {
            key: "large-amount",
            title: "Large amount and count",
            props: () => ({
                title: "Puppy class package",
                meta: "12 sessions",
                count: 12,
                cents: 1234500,
                onRemove: noop,
                removeLabel: "Remove puppy class package",
            }),
        },
        {
            key: "long",
            title: "Long text",
            props: () => ({
                title: "Full groom with de-shedding treatment, blueberry facial, nail grind and teeth brushing",
                meta: "Biscuit, Mochi and Pepper · Hannah Lee and Priya Shah · Saturday morning drop-off",
                tag: { label: "Bundle saves 15%", intent: "success" },
                cents: 18900,
                originalCents: 22200,
                onRemove: noop,
                removeLabel: "Remove full groom",
            }),
        },
        {
            key: "rtl",
            title: "Right-to-left name",
            props: () => ({
                title: "قص أظافر وتنظيف الأذنين للكلب الصغير",
                meta: "ليلى حداد · بسكويت",
                cents: 4000,
            }),
        },
    ],
});
