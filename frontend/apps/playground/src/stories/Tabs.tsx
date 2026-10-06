import type { TabsProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

type Key = "invoices" | "sales" | "gift-cards" | "staff-pay" | "reports";

const ITEMS: TabsProps<Key>["items"] = [
    { key: "invoices", label: "Invoices" },
    { key: "sales", label: "Sales" },
    { key: "gift-cards", label: "Gift cards" },
    { key: "staff-pay", label: "Staff pay" },
    { key: "reports", label: "Reports" },
];

export default story<TabsProps<Key>>({
    component: "Tabs",
    summary: "The underline tab bar, or a row of pills for a view switch.",
    controls: {
        variant: { type: "select", options: ["underline", "pill"] },
        active: { type: "select", options: ITEMS.map((i) => i.key) },
        inset: { type: "boolean" },
    },
    examples: [
        {
            key: "underline",
            title: "Underline",
            props: () => ({ items: ITEMS, active: "invoices", onSelect: noop, label: "Payments" }),
        },
        {
            key: "pill",
            title: "Pills",
            props: () => ({
                items: [
                    { key: "invoices", label: "Agenda" },
                    { key: "sales", label: "Day" },
                ],
                active: "sales",
                variant: "pill",
                onSelect: noop,
                label: "Schedule view",
            }),
        },
        {
            key: "flush",
            title: "Pills without side padding",
            props: () => ({
                items: ITEMS.slice(0, 3),
                active: "invoices",
                variant: "pill",
                inset: false,
                onSelect: noop,
            }),
        },
    ],
});
