import type { FormQuestionField, FormQuestionProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

const field = (
    input: string,
    label: string,
    extra: Partial<FormQuestionField> = {},
): FormQuestionField => ({
    input,
    name: label.toLowerCase().replace(/\W+/g, "_"),
    label,
    help: null,
    required: false,
    options: [],
    ...extra,
});

const base = { chooseFileLabel: "Choose a file", selectPlaceholder: "Choose one" };

export default story<FormQuestionProps>({
    component: "FormQuestion",
    summary: "One intake-form question, the same in the builder preview and on the client's form.",
    controls: { invalid: { type: "boolean" } },
    examples: [
        {
            key: "short-text",
            title: "Short text",
            props: () => ({
                ...base,
                field: field("text", "Pet's name", { required: true }),
                value: "Biscuit",
                onChange: noop,
            }),
        },
        {
            key: "long-text",
            title: "Long text with help",
            props: () => ({
                ...base,
                field: field("longtext", "Anything we should know?", {
                    help: "Allergies, behaviour, past groomer notes.",
                }),
                value: "Gets anxious with clippers near the ears.",
                onChange: noop,
            }),
        },
        {
            key: "date",
            title: "Date",
            props: () => ({
                ...base,
                field: field("date", "Last rabies vaccine"),
                value: "2026-03-14",
                onChange: noop,
            }),
        },
        {
            key: "select",
            title: "Select",
            props: () => ({
                ...base,
                field: field("select", "Coat type", { options: ["Short", "Double", "Curly"] }),
                value: "Double",
                onChange: noop,
            }),
        },
        {
            key: "multiselect",
            title: "Several choices",
            props: () => ({
                ...base,
                field: field("multiselect", "Add-ons", {
                    options: ["Nail trim", "Teeth", "Blueberry facial"],
                }),
                value: ["Nail trim"],
                onChange: noop,
            }),
        },
        {
            key: "checkbox",
            title: "Checkbox",
            props: () => ({
                ...base,
                field: field("checkbox", "I agree to the cancellation policy", { required: true }),
                value: true,
                onChange: noop,
            }),
        },
        {
            key: "file",
            title: "File, nothing chosen",
            props: () => ({
                ...base,
                field: field("file", "Vaccination record"),
                value: undefined,
                onChange: noop,
            }),
        },
        {
            key: "file-chosen",
            title: "File chosen",
            props: () => ({
                ...base,
                field: field("file", "Vaccination record"),
                value: undefined,
                fileName: "biscuit-vaccines.pdf",
                onChange: noop,
            }),
        },
        {
            key: "invalid",
            title: "Missing a required answer",
            props: () => ({
                ...base,
                field: field("text", "Emergency contact", { required: true }),
                value: "",
                invalid: true,
                onChange: noop,
            }),
        },
        {
            key: "preview",
            title: "Builder preview (read-only)",
            props: () => ({
                ...base,
                field: field("email", "Email", { required: true }),
                value: undefined,
            }),
        },
    ],
});
