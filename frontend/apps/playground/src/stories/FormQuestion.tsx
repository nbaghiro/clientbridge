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

const STATE = { value: "value", onChange: "onChange" };

const base = { chooseFileLabel: "Choose a file", selectPlaceholder: "Choose one" };

export default story<FormQuestionProps>({
    component: "FormQuestion",
    summary: "One intake-form question, the same in the builder preview and on the client's form.",
    controls: {
        invalid: { type: "boolean" },
        chooseFileLabel: { type: "text" },
        selectPlaceholder: { type: "text" },
    },
    examples: [
        {
            key: "short-text",
            state: STATE,
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
            state: STATE,
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
            state: STATE,
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
            state: STATE,
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
            state: STATE,
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
            state: STATE,
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
            state: STATE,
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
        {
            key: "number-phone",
            title: "Phone",
            state: STATE,
            props: () => ({
                ...base,
                field: field("phone", "Emergency contact phone", { required: true }),
                value: "+1 250 555 0101",
                onChange: noop,
            }),
        },
        {
            key: "address",
            title: "Address",
            state: STATE,
            props: () => ({
                ...base,
                field: field("address", "Home address", { help: "For mobile grooming visits." }),
                value: "1148 Birch Bark Lane\nVictoria, BC V8V 1A1",
                onChange: noop,
            }),
        },
        {
            key: "select-empty-invalid",
            title: "Select, nothing chosen, required",
            state: STATE,
            props: () => ({
                ...base,
                field: field("select", "Coat type", {
                    required: true,
                    options: ["Short", "Double", "Curly"],
                }),
                value: undefined,
                invalid: true,
                onChange: noop,
            }),
        },
        {
            key: "file-invalid",
            title: "File missing, required",
            props: () => ({
                ...base,
                field: field("file", "Vaccination record", { required: true }),
                value: undefined,
                invalid: true,
                onChange: noop,
            }),
        },
        {
            key: "long-label",
            title: "Long label, help and file name",
            props: () => ({
                ...base,
                field: field(
                    "file",
                    "Upload a recent vaccination record from your veterinarian showing rabies, distemper and bordetella",
                    {
                        help: "We accept PDF, JPEG, PNG or HEIC photos of the paper record. Records older than one year can't be accepted for boarding.",
                    },
                ),
                value: undefined,
                fileName:
                    "biscuit-golden-retriever-vaccination-record-victoria-animal-hospital-2026-03-14-final-v2.pdf",
                onChange: noop,
            }),
        },
        {
            key: "rtl",
            title: "Right-to-left",
            state: STATE,
            props: () => ({
                ...base,
                field: field("multiselect", "الإضافات", {
                    help: "اختر ما يناسب حيوانك الأليف.",
                    options: ["قص الأظافر", "تنظيف الأسنان", "تنظيف الأذن"],
                }),
                value: ["قص الأظافر"],
                onChange: noop,
            }),
        },
    ],
});
