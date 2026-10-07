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

const SELECT = { value: "active", onChange: "onSelect" };

export default story<TabsProps<string>>({
    component: "Tabs",
    summary: "The underline tab bar, or a row of pills for a view switch.",
    controls: {
        variant: { type: "select", options: ["underline", "pill"] },
        active: { type: "select", options: ITEMS.map((i) => i.key) },
        inset: { type: "boolean" },
        label: { type: "text" },
    },
    examples: [
        {
            key: "underline",
            title: "Underline, controlled",
            state: SELECT,
            props: () => ({ items: ITEMS, active: "invoices", onSelect: noop, label: "Payments" }),
        },
        {
            key: "pill",
            title: "Pills, controlled",
            state: SELECT,
            props: () => ({
                items: [
                    { key: "agenda", label: "Agenda" },
                    { key: "day", label: "Day" },
                ],
                active: "day",
                variant: "pill",
                onSelect: noop,
                label: "Schedule view",
            }),
        },
        {
            key: "flush",
            title: "Pills without side padding",
            state: SELECT,
            props: () => ({
                items: ITEMS.slice(0, 3),
                active: "invoices",
                variant: "pill",
                inset: false,
                onSelect: noop,
                label: "Payments",
            }),
        },
        {
            key: "underline-flush",
            title: "Underline without side padding",
            state: SELECT,
            props: () => ({
                items: ITEMS.slice(0, 3),
                active: "sales",
                inset: false,
                onSelect: noop,
                label: "Payments",
            }),
        },
        {
            key: "two",
            title: "Two tabs",
            state: SELECT,
            props: () => ({
                items: [
                    { key: "upcoming", label: "Upcoming" },
                    { key: "past", label: "Past" },
                ],
                active: "past",
                onSelect: noop,
                label: "Visits",
            }),
        },
        {
            key: "long",
            title: "Long labels",
            state: SELECT,
            props: () => ({
                items: [
                    { key: "a", label: "Outstanding invoices and estimates" },
                    { key: "b", label: "Refunds and disputes" },
                    { key: "c", label: "Payouts to your bank account" },
                ],
                active: "a",
                onSelect: noop,
                label: "Money",
            }),
        },
        {
            key: "many",
            title: "More tabs than fit, scrolling sideways",
            state: SELECT,
            props: () => ({
                items: [
                    { key: "a", label: "Invoices" },
                    { key: "b", label: "Estimates" },
                    { key: "c", label: "Sales" },
                    { key: "d", label: "Gift cards" },
                    { key: "e", label: "Packages" },
                    { key: "f", label: "Memberships" },
                    { key: "g", label: "Staff pay" },
                    { key: "h", label: "Payouts" },
                    { key: "i", label: "Tax returns" },
                    { key: "j", label: "Reports" },
                ],
                active: "a",
                onSelect: noop,
                label: "Payments",
            }),
        },
        {
            key: "rtl",
            title: "Hebrew labels",
            state: SELECT,
            props: () => ({
                items: [
                    { key: "a", label: "חשבוניות" },
                    { key: "b", label: "מכירות" },
                    { key: "c", label: "כרטיסי מתנה" },
                ],
                active: "b",
                variant: "pill",
                onSelect: noop,
                label: "תשלומים",
            }),
        },
    ],
});
