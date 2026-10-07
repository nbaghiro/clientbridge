import type { ActionMenuItem, ActionMenuProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

const ITEMS: readonly ActionMenuItem[] = [
    {
        key: "booking",
        label: "New booking",
        hint: "Book a client in",
        icon: "calendar",
        shortcut: "B",
    },
    {
        key: "sale",
        label: "New sale",
        hint: "Ring up products or a service",
        icon: "pos",
        shortcut: "S",
    },
    {
        key: "invoice",
        label: "New invoice",
        hint: "Bill a client",
        icon: "invoices",
        shortcut: "I",
    },
    {
        key: "client",
        label: "New client",
        hint: "Add someone to your list",
        icon: "clients",
        shortcut: "C",
    },
];

export default story<ActionMenuProps>({
    component: "ActionMenu",
    summary: "A list or grid of actions: a popover on web, a bottom sheet on mobile.",
    controls: {
        title: { type: "text" },
        layout: { type: "select", options: ["list", "grid"] },
        placement: {
            type: "select",
            options: ["below-start", "below-end", "above-start", "above-end"],
        },
    },
    examples: [
        {
            key: "list",
            title: "List",
            overlay: true,
            props: () => ({
                open: false,
                onClose: noop,
                title: "Create",
                items: ITEMS,
                onSelect: noop,
            }),
        },
        {
            key: "grid",
            title: "Grid",
            overlay: true,
            props: () => ({
                open: false,
                onClose: noop,
                title: "Create",
                items: ITEMS,
                onSelect: noop,
                layout: "grid",
            }),
        },
        {
            key: "grid-footer",
            title: "Grid with a footer, opening above",
            overlay: true,
            props: (k) => ({
                open: false,
                onClose: noop,
                title: "Create",
                items: ITEMS,
                onSelect: noop,
                layout: "grid",
                placement: "above-start",
                footer: <k.Text tone="muted">Recent: Biscuit, Juniper</k.Text>,
            }),
        },
        {
            key: "long",
            title: "Long labels and a right-to-left name",
            overlay: true,
            props: () => ({
                open: false,
                onClose: noop,
                title: "Book again",
                onSelect: noop,
                items: [
                    {
                        key: "long",
                        label: "Book Bartholomew Featherstonehaugh-Montgomery's full groom and nail trim",
                        hint: "Last visit Sep 28 with Hannah Lee, full groom, nail trim, teeth and a bow",
                        icon: "calendar",
                        shortcut: "B",
                    },
                    {
                        key: "rtl",
                        label: "ליאור בן-דוד · טיפוח מלא",
                        hint: "ليلى حداد، زيارة كل أربعة أسابيع",
                        icon: "clients",
                    },
                ],
            }),
        },
        {
            key: "flip",
            title: "Below and to the end by preference, flipped to stay in the window",
            overlay: true,
            props: () => ({
                open: false,
                onClose: noop,
                title: "Create",
                items: ITEMS,
                onSelect: noop,
                layout: "grid",
                placement: "below-end",
            }),
        },
        {
            key: "footer",
            title: "With a footer",
            overlay: true,
            props: (k) => ({
                open: false,
                onClose: noop,
                items: ITEMS.slice(0, 2),
                onSelect: noop,
                placement: "below-end",
                footer: (
                    <k.Stack row>
                        <k.Avatar name="Amélie Tremblay" size="sm" />
                        <k.Text tone="muted">Book Amélie again</k.Text>
                    </k.Stack>
                ),
            }),
        },
    ],
});
