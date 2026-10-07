import type { StepperProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

export default story<StepperProps>({
    component: "Stepper",
    summary: "A minus and plus quantity control.",
    controls: { value: { type: "number", min: 0, max: 20 }, label: { type: "text" } },
    examples: [
        {
            key: "default",
            title: "Quantity",
            props: () => ({ value: 2, onChange: noop, label: "Oatmeal shampoo" }),
        },
        {
            key: "controlled",
            title: "Controlled, 0 to 10",
            state: { value: "value", onChange: "onChange" },
            props: () => ({ value: 3, min: 0, max: 10, onChange: noop, label: "Treats" }),
        },
        {
            key: "large-value",
            title: "Three-digit value",
            state: { value: "value", onChange: "onChange" },
            props: () => ({ value: 120, min: 0, max: 999, onChange: noop, label: "Bags of food" }),
        },
        {
            key: "at-min",
            title: "At the minimum",
            props: () => ({ value: 1, min: 1, onChange: noop, label: "Nail trims" }),
        },
        {
            key: "at-max",
            title: "At the maximum",
            props: () => ({ value: 6, min: 0, max: 6, onChange: noop, label: "Class seats" }),
        },
    ],
});
