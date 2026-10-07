import type { SelectProps } from "@clientbridge/app-core";

import { story } from "../story";

type Coat = "short" | "double" | "curly" | "wire";

const COATS: SelectProps<Coat>["options"] = [
    { key: "short", label: "Short coat" },
    { key: "double", label: "Double coat" },
    { key: "curly", label: "Curly coat" },
    { key: "wire", label: "Wire coat" },
];

const SERVICES: SelectProps<string>["options"] = [
    { key: "bath", label: "Bath and brush", detail: "45 min · $45.00", group: "Baths" },
    { key: "bath-lg", label: "Bath and brush, large dog", detail: "1 h · $65.00", group: "Baths" },
    { key: "full", label: "Full groom", detail: "1 h 30 min · $85.00", group: "Grooms" },
    { key: "puppy", label: "Puppy intro groom", detail: "45 min · $40.00", group: "Grooms" },
    { key: "strip", label: "Hand strip", detail: "2 h · $120.00", group: "Grooms" },
    { key: "nails", label: "Nail trim", detail: "15 min · $15.00", group: "Add-ons" },
    { key: "teeth", label: "Teeth brushing", detail: "10 min · $10.00", group: "Add-ons" },
    {
        key: "deshed",
        label: "De-shedding treatment",
        detail: "30 min · $25.00",
        group: "Add-ons",
        disabled: true,
    },
];

const CLIENTS = [
    "Amélie Tremblay",
    "Marcus Bennett",
    "Olivia Martin",
    "Sophie Nguyen",
    "Yuki Tanaka",
    "Ethan Wright",
    "Grace Lin",
    "Liam O'Connor",
    "Noah Schmidt",
    "Priya Patel",
    "Diego Ramirez",
    "Hannah Wong",
    "Chloé Gagnon",
].map((name) => ({ key: name, label: name }));

export default story<SelectProps<string>>({
    component: "Select",
    summary:
        "A labelled field that opens our own list: details, groups, a placeholder, and a search box over long lists. Chips on mobile for a few plain options.",
    controls: {
        label: { type: "text" },
        hint: { type: "text" },
        error: { type: "text" },
        placeholder: { type: "text" },
        size: { type: "select", options: ["sm", "md", "lg"] },
        searchable: { type: "boolean" },
        disabled: { type: "boolean" },
    },
    examples: [
        {
            key: "select",
            title: "Default",
            props: () => ({ label: "Coat type", defaultValue: "double", options: COATS }),
        },
        {
            key: "select-detail",
            title: "Details and groups, with a placeholder",
            props: () => ({
                label: "Service",
                placeholder: "Choose a service",
                options: SERVICES,
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
            props: () => ({ name: "Coat type", size: "sm", defaultValue: "short", options: COATS }),
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
        {
            key: "select-controlled",
            title: "Controlled",
            state: { value: "value", onChange: "onChange" },
            props: () => ({ label: "Coat type", value: "curly", options: COATS }),
        },
        {
            key: "select-large",
            title: "Large",
            props: () => ({ label: "Coat type", size: "lg", defaultValue: "wire", options: COATS }),
        },
        {
            key: "select-long",
            title: "Long option labels",
            props: () => ({
                label: "Cancellation policy",
                defaultValue: "strict",
                options: [
                    {
                        key: "strict",
                        label: "Strict: no refund within 48 hours of the appointment, deposit kept",
                    },
                    { key: "flexible", label: "Flexible: free until 2 hours before" },
                ],
            }),
        },
        {
            key: "select-many",
            title: "Many options, with a search box",
            props: () => ({ label: "Client", options: CLIENTS, defaultValue: "Marcus Bennett" }),
        },
        {
            key: "select-empty",
            title: "No options yet",
            props: () => ({ label: "Room", placeholder: "Choose a room", options: [] }),
        },
        {
            key: "select-rtl",
            title: "Right-to-left",
            props: () => ({
                label: "نوع الفراء",
                defaultValue: "b",
                options: [
                    { key: "a", label: "قصير" },
                    { key: "b", label: "مزدوج" },
                    { key: "c", label: "مجعد" },
                ],
            }),
        },
    ],
});
