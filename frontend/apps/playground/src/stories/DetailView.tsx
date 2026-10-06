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
        ],
    }),
];
