import type { FieldProps, SelectProps, TextFieldProps, ToggleProps } from "@clientbridge/app-core";

import { story } from "../story";

type Coat = "short" | "double" | "curly" | "wire";

const COATS: SelectProps<Coat>["options"] = [
    { key: "short", label: "Short coat" },
    { key: "double", label: "Double coat" },
    { key: "curly", label: "Curly coat" },
    { key: "wire", label: "Wire coat" },
];

export default [
    story<FieldProps>({
        component: "Field",
        summary: "A label, hint and error around any control that isn't a text field.",
        controls: {
            label: { type: "text" },
            hint: { type: "text" },
            error: { type: "text" },
            optional: { type: "boolean" },
            required: { type: "boolean" },
        },
        examples: [
            {
                key: "field",
                title: "Label and hint",
                props: (k) => ({
                    label: "Preferred groomer",
                    hint: "Clients see this on their booking page.",
                    children: <k.Text>Hannah Lee</k.Text>,
                }),
            },
            {
                key: "field-required",
                title: "Required",
                props: (k) => ({
                    label: "Pet",
                    required: true,
                    children: <k.Text>Biscuit</k.Text>,
                }),
            },
            {
                key: "field-optional",
                title: "Optional",
                props: (k) => ({
                    label: "Notes",
                    optional: true,
                    children: <k.Text tone="muted">None yet</k.Text>,
                }),
            },
            {
                key: "field-error",
                title: "Error",
                props: (k) => ({
                    label: "Deposit",
                    error: "Choose a deposit or turn deposits off.",
                    children: <k.Text tone="muted">Nothing chosen</k.Text>,
                }),
            },
        ],
    }),
    story<TextFieldProps>({
        component: "TextField",
        summary:
            "A labelled text input or multi-line box, with hint, error, prefix and three sizes.",
        controls: {
            label: { type: "text" },
            placeholder: { type: "text" },
            hint: { type: "text" },
            error: { type: "text" },
            size: { type: "select", options: ["sm", "md", "lg"] },
            surface: { type: "select", options: ["bg", "surface"] },
            width: { type: "select", options: ["full", "narrow", "auto"] },
            multiline: { type: "boolean" },
            disabled: { type: "boolean" },
            optional: { type: "boolean" },
        },
        examples: [
            {
                key: "text",
                title: "Text",
                props: () => ({ label: "Client name", defaultValue: "Amélie Tremblay" }),
            },
            {
                key: "text-placeholder",
                title: "Empty with a placeholder",
                props: () => ({
                    label: "Email",
                    type: "email",
                    placeholder: "name@example.com",
                    defaultValue: "",
                }),
            },
            {
                key: "text-hint",
                title: "Hint and optional",
                props: () => ({
                    label: "Phone",
                    type: "tel",
                    optional: true,
                    hint: "Used for appointment reminders by text.",
                    defaultValue: "+1 250 555 0101",
                }),
            },
            {
                key: "text-error",
                title: "Error",
                props: () => ({
                    label: "Email",
                    defaultValue: "diego@",
                    error: "Enter a full email address.",
                }),
            },
            {
                key: "text-prefix",
                title: "Prefix",
                props: () => ({
                    label: "Booking link",
                    prefix: "book.clientbridge.ca/",
                    defaultValue: "birchbark",
                }),
            },
            {
                key: "text-multiline",
                title: "Multi-line",
                props: () => ({
                    label: "Grooming notes",
                    multiline: true,
                    rows: 4,
                    defaultValue:
                        "Biscuit is nervous with the dryer. Use the quiet setting and take breaks.",
                }),
            },
            {
                key: "text-small",
                title: "Small and narrow",
                props: () => ({
                    label: "Quantity",
                    type: "number",
                    size: "sm",
                    width: "narrow",
                    defaultValue: "2",
                }),
            },
            {
                key: "text-large",
                title: "Large",
                props: () => ({
                    placeholder: "Search clients and pets",
                    size: "lg",
                    defaultValue: "",
                }),
            },
            {
                key: "text-disabled",
                title: "Disabled",
                props: () => ({
                    label: "Business number",
                    defaultValue: "81234 5678 RT0001",
                    disabled: true,
                }),
            },
        ],
    }),
    story<SelectProps<Coat>>({
        component: "Select",
        summary: "A labelled select on web and a row of chips on mobile.",
        controls: {
            label: { type: "text" },
            hint: { type: "text" },
            error: { type: "text" },
            size: { type: "select", options: ["sm", "md", "lg"] },
            disabled: { type: "boolean" },
        },
        examples: [
            {
                key: "select",
                title: "Default",
                props: () => ({
                    label: "Coat type",
                    defaultValue: "double",
                    options: COATS,
                }),
            },
            {
                key: "select-hint",
                title: "Hint",
                props: () => ({
                    label: "Coat type",
                    hint: "Sets the default length of a full groom.",
                    defaultValue: "curly",
                    options: COATS,
                }),
            },
            {
                key: "select-error",
                title: "Error",
                props: () => ({
                    label: "Coat type",
                    error: "Wire coats need a hand-strip add-on.",
                    defaultValue: "wire",
                    options: COATS,
                }),
            },
            {
                key: "select-small",
                title: "Small, no label",
                props: () => ({
                    name: "Coat type",
                    size: "sm",
                    defaultValue: "short",
                    options: COATS,
                }),
            },
            {
                key: "select-disabled",
                title: "Disabled",
                props: () => ({
                    label: "Coat type",
                    disabled: true,
                    defaultValue: "short",
                    options: COATS,
                }),
            },
        ],
    }),
    story<ToggleProps>({
        component: "Toggle",
        summary: "A checkbox on web and a switch on mobile, with a label and hint.",
        controls: {
            label: { type: "text" },
            hint: { type: "text" },
            value: { type: "boolean" },
            disabled: { type: "boolean" },
        },
        examples: [
            {
                key: "toggle-on",
                title: "On",
                props: () => ({ label: "Send reminders by text", defaultValue: true }),
            },
            {
                key: "toggle-off",
                title: "Off with a hint",
                props: () => ({
                    label: "Take deposits",
                    hint: "Clients pay 20% when they book online.",
                    defaultValue: false,
                }),
            },
            {
                key: "toggle-disabled",
                title: "Disabled",
                props: () => ({
                    label: "Accept tips",
                    defaultValue: true,
                    disabled: true,
                }),
            },
        ],
    }),
];
