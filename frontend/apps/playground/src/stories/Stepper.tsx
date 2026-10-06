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
