import type { FieldProps, TextFieldProps, ToggleProps } from "@clientbridge/app-core";

import { story } from "../story";

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
            {
                key: "field-long",
                title: "Long label, hint and error",
                props: (k) => ({
                    label: "Which groomer should clients see first when they book a full groom online",
                    hint: "If that groomer is fully booked, clients are offered the next available groomer with the same services and a similar price.",
                    error: "Pick a groomer who offers full grooms, or turn off online booking for this service.",
                    required: true,
                    children: <k.Text>Hannah Lee</k.Text>,
                }),
            },
            {
                key: "field-rtl",
                title: "Right-to-left",
                props: (k) => ({
                    label: "المصفف المفضل",
                    hint: "يرى العملاء هذا في صفحة الحجز.",
                    children: <k.Text>هناء لي</k.Text>,
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
            {
                key: "text-controlled",
                title: "Controlled",
                state: { value: "value", onChange: "onChange" },
                props: () => ({
                    label: "Pet name",
                    value: "Biscuit",
                    hint: "Typing updates the value the parent holds.",
                    maxLength: 30,
                }),
            },
            {
                key: "text-password",
                title: "Password",
                props: () => ({
                    label: "Password",
                    type: "password",
                    autoComplete: "new-password",
                    defaultValue: "correct horse",
                    required: true,
                }),
            },
            {
                key: "text-prefix-error",
                title: "Prefix with an error, on a surface",
                props: () => ({
                    label: "Deposit",
                    prefix: "$",
                    type: "number",
                    surface: "surface",
                    width: "narrow",
                    defaultValue: "-5",
                    error: "Enter an amount above zero.",
                }),
            },
            {
                key: "text-auto",
                title: "Auto width",
                props: () => ({ label: "Code", width: "auto", defaultValue: "BB-1148" }),
            },
            {
                key: "text-long",
                title: "Long label and value",
                props: () => ({
                    label: "How should we greet your pet when they arrive for their first full groom with us",
                    defaultValue:
                        "Sir Reginald Fluffington III, Esquire, Keeper of the Back Garden and Destroyer of Tennis Balls",
                    hint: "We print this on the kennel card.",
                }),
            },
            {
                key: "text-rtl",
                title: "Right-to-left",
                props: () => ({
                    label: "اسم العميل",
                    defaultValue: "نور الهدى عبد الرحمن",
                    hint: "كما يظهر في الفواتير.",
                }),
            },
        ],
    }),
    story<ToggleProps>({
        component: "Toggle",
        summary: "A switch with a label and hint, on web and mobile.",
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
            {
                key: "toggle-controlled",
                title: "Controlled",
                state: { value: "value", onChange: "onChange" },
                props: () => ({ label: "Show prices on the booking page", value: false }),
            },
            {
                key: "toggle-long",
                title: "Long label and hint",
                props: () => ({
                    label: "Send clients a reminder by text and by email the day before every appointment, including recurring visits",
                    hint: "Clients who opted out of texts get the email only. Reminders go out at 10 a.m. in your business's time zone.",
                    defaultValue: true,
                }),
            },
            {
                key: "toggle-rtl",
                title: "Right-to-left",
                props: () => ({
                    label: "إرسال التذكيرات",
                    hint: "قبل يوم من الموعد.",
                    defaultValue: true,
                }),
            },
        ],
    }),
];
