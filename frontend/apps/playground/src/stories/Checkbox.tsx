import type { CheckboxProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<CheckboxProps>({
    component: "Checkbox",
    summary: "A labelled checkbox, with a mixed state for a partly chosen group.",
    controls: {
        label: { type: "text" },
        hideLabel: { type: "boolean" },
        mixed: { type: "boolean" },
        disabled: { type: "boolean" },
    },
    examples: [
        {
            key: "unchecked",
            title: "Unchecked",
            props: () => ({ label: "Send a reminder the day before" }),
        },
        {
            key: "checked",
            title: "Checked",
            props: () => ({ label: "Text when ready", defaultValue: true }),
        },
        {
            key: "mixed",
            title: "Mixed",
            props: () => ({ label: "Select all invoices", mixed: true }),
        },
        {
            key: "hidden-label",
            title: "Label for screen readers only",
            props: () => ({ label: "Select invoice 1148", hideLabel: true }),
        },
        {
            key: "disabled",
            title: "Disabled",
            props: () => ({ label: "Charge the card on file", disabled: true, defaultValue: true }),
        },
    ],
});
