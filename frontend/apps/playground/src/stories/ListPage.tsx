import type { ListPageProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

interface Client {
    id: string;
    name: string;
    pet: string;
    cents: number;
}

const CLIENTS: Client[] = [
    { id: "c1", name: "Amélie Tremblay", pet: "Biscuit", cents: 214592 },
    { id: "c2", name: "Diego Ruiz", pet: "Mochi", cents: 98400 },
    { id: "c3", name: "Grace Lin", pet: "Pepper", cents: 220304 },
];

type Segment = "active" | "archived";

const rowProps = {
    rowKey: (c: Client) => c.id,
    onRowPress: noop,
};

export default story<ListPageProps<Client, Segment>>({
    component: "ListPage",
    summary:
        "A list screen: header, count, primary action, segments, search, rows and an empty state.",
    controls: { title: { type: "text" }, summary: { type: "text" }, empty: { type: "text" } },
    examples: [
        {
            key: "full",
            title: "Header, segments and search",
            props: (k) => ({
                ...rowProps,
                title: "Clients",
                summary: "3 total",
                action: { label: "Add client", onPress: noop },
                segments: {
                    items: [
                        { key: "active", label: "Active" },
                        { key: "archived", label: "Archived" },
                    ],
                    active: "active",
                    onSelect: noop,
                },
                search: { value: "", onChange: noop, placeholder: "Search clients…" },
                rows: CLIENTS,
                renderRow: (c) => (
                    <k.Stack row>
                        <k.Avatar name={c.name} size="sm" />
                        <k.Text>{`${c.name} · ${c.pet}`}</k.Text>
                        <k.Money cents={c.cents} />
                    </k.Stack>
                ),
                empty: "No clients yet.",
            }),
        },
        {
            key: "plain",
            title: "Rows only",
            props: (k) => ({
                ...rowProps,
                rows: CLIENTS,
                renderRow: (c) => <k.Text>{c.name}</k.Text>,
                empty: "No clients yet.",
            }),
        },
        {
            key: "banner-footer",
            title: "Banner and footer",
            props: (k) => ({
                ...rowProps,
                title: "Invoices",
                banner: <k.Badge label="2 overdue" intent="danger" />,
                rows: CLIENTS.slice(0, 2),
                renderRow: (c) => <k.Text>{c.name}</k.Text>,
                footer: <k.Text tone="muted">Showing the last 30 days</k.Text>,
                empty: "No invoices.",
            }),
        },
        {
            key: "empty",
            title: "Empty",
            props: (k) => ({
                ...rowProps,
                title: "Clients",
                action: { label: "Add client", onPress: noop },
                search: { value: "zz", onChange: noop, placeholder: "Search clients…" },
                rows: [],
                renderRow: (c) => <k.Text>{c.name}</k.Text>,
                empty: "No clients match “zz”.",
            }),
        },
    ],
});
