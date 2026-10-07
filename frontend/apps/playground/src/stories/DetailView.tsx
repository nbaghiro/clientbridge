import type { DetailSectionProps, DetailViewProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

export default [
    story<DetailViewProps>({
        component: "DetailView",
        summary: "A record's details: a side panel on web, a bottom sheet on mobile.",
        controls: { title: { type: "text" }, subtitle: { type: "text" } },
        examples: [
            {
                key: "client",
                title: "Client",
                overlay: true,
                props: (k) => ({
                    open: false,
                    onClose: noop,
                    title: "Amélie Tremblay",
                    subtitle: "Client since 2024 · Biscuit, Maple",
                    status: { status: "active", intent: "success" },
                    leading: <k.Avatar name="Amélie Tremblay" size="lg" />,
                    actions: (
                        <k.Stack row>
                            <k.Button size="sm" variant="outline">
                                Message
                            </k.Button>
                            <k.Button size="sm">Book</k.Button>
                        </k.Stack>
                    ),
                    children: <k.Text>Next visit Tuesday at 9:30 a.m. Lifetime $2,145.92.</k.Text>,
                }),
            },
            {
                key: "plain",
                title: "Without status or actions",
                overlay: true,
                props: (k) => ({
                    open: false,
                    onClose: noop,
                    title: "Oatmeal Soothe Shampoo",
                    children: <k.Text tone="muted">500 ml · 12 in stock</k.Text>,
                }),
            },
            {
                key: "overdue",
                title: "Danger status with an icon",
                overlay: true,
                props: (k) => ({
                    open: false,
                    onClose: noop,
                    title: "Invoice 1148",
                    subtitle: "Due Sep 30 · Diego Ruiz",
                    status: { status: "overdue", intent: "danger" },
                    leading: <k.Icon name="invoices" size={28} />,
                    actions: <k.Button size="sm">Send reminder</k.Button>,
                    children: <k.Money cents={8400} strong />,
                }),
            },
            {
                key: "long",
                title: "Long title and subtitle",
                overlay: true,
                props: (k) => ({
                    open: false,
                    onClose: noop,
                    title: "Maximiliana Featherstonehaugh-Villanueva and the Okonkwo-Lindqvist family",
                    subtitle:
                        "Client since 2019 · Biscuit, Maple, Juniper, Pepper, Clementine and Sir Reginald Fluffington III",
                    status: { status: "pending", intent: "warning" },
                    children: <k.Text>Three visits booked this month.</k.Text>,
                }),
            },
            {
                key: "rtl",
                title: "Right-to-left title",
                overlay: true,
                props: (k) => ({
                    open: false,
                    onClose: noop,
                    title: "نور الهدى عبد الرحمن",
                    subtitle: "عميلة منذ ٢٠٢٤",
                    status: { status: "active", intent: "success" },
                    leading: <k.Avatar name="نور الهدى" size="lg" />,
                    children: <k.Text>الزيارة القادمة يوم الثلاثاء.</k.Text>,
                }),
            },
        ],
    }),
    story<DetailSectionProps>({
        component: "DetailSection",
        summary: "A titled block inside a DetailView, with an optional action.",
        controls: { title: { type: "text" } },
        examples: [
            {
                key: "section",
                title: "With an action",
                props: (k) => ({
                    title: "Pets",
                    action: (
                        <k.Button size="sm" variant="link">
                            Add pet
                        </k.Button>
                    ),
                    children: <k.Text>Biscuit, cockapoo, 4 years</k.Text>,
                }),
            },
            {
                key: "untitled",
                title: "Untitled",
                props: (k) => ({ children: <k.Text tone="muted">No notes yet.</k.Text> }),
            },
            {
                key: "section-long",
                title: "Long title beside an action",
                props: (k) => ({
                    title: "Vaccination records, signed waivers and grooming consent forms on file",
                    action: (
                        <k.Button size="sm" variant="link">
                            Upload
                        </k.Button>
                    ),
                    children: <k.Text>Rabies, Sep 2026</k.Text>,
                }),
            },
        ],
    }),
];
