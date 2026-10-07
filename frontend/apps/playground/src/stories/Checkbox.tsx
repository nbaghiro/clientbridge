import type { CheckboxProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

// rows draws the checkbox once per table row with its label hidden, as a list screen does.
type Props = CheckboxProps & { rows?: readonly string[] };

export default story<Props>({
    component: "Checkbox",
    summary: "A labelled checkbox, with a mixed state for a partly chosen group.",
    controls: {
        label: { type: "text" },
        hideLabel: { type: "boolean" },
        mixed: { type: "boolean" },
        disabled: { type: "boolean" },
    },
    render: (k, { rows, ...props }) =>
        rows === undefined ? (
            <k.Checkbox {...props} />
        ) : (
            <k.Stack>
                {rows.map((r) => (
                    <k.Stack key={r} row>
                        <k.Checkbox label={`Show ${r} online`} hideLabel defaultValue />
                        <k.Text>{r}</k.Text>
                    </k.Stack>
                ))}
            </k.Stack>
        ),
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
            key: "controlled",
            title: "Controlled",
            state: { value: "value", onChange: "onChange" },
            props: () => ({ label: "Charge a no-show fee", value: false, onChange: noop }),
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
            key: "hidden-label-rows",
            title: "Hidden labels in table rows (the label stays inside its row)",
            props: () => ({
                label: "Online",
                rows: Array.from({ length: 12 }, (_, i) => `Service ${String(i + 1)}`),
            }),
        },
        {
            key: "disabled",
            title: "Disabled, checked",
            props: () => ({ label: "Charge the card on file", disabled: true, defaultValue: true }),
        },
        {
            key: "disabled-off",
            title: "Disabled, unchecked",
            props: () => ({ label: "Accept tips", disabled: true }),
        },
        {
            key: "disabled-mixed",
            title: "Disabled, mixed",
            props: () => ({ label: "Select all clients", disabled: true, mixed: true }),
        },
        {
            key: "long",
            title: "Long label (wraps)",
            props: () => ({
                label: "Let clients book back-to-back visits for more than one pet in the same household, as long as the groomer has room in their day",
            }),
        },
        {
            key: "rtl",
            title: "Right-to-left label",
            props: () => ({ label: "שלח תזכורת ללקוח · أرسل تذكيرًا", defaultValue: true }),
        },
    ],
});
