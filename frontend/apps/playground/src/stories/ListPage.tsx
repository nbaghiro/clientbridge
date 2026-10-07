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

const LONG: Client[] = [
    {
        id: "l1",
        name: "Maximiliane Alexandra Featherstonehaugh-Wolfeschlegel",
        pet: "Sir Reginald Biscuit the Third",
        cents: 1234500,
    },
    { id: "l2", name: "ليلى حداد", pet: "بسكويت", cents: 8500 },
    { id: "l3", name: "נועה כהן", pet: "מוקה", cents: 5500 },
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
    controls: {
        title: { type: "text" },
        summary: { type: "text" },
        empty: { type: "text" },
        state: { type: "select", options: ["loading", "error"] },
    },
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
        {
            key: "accessory-head",
            title: "Accessory and a column head",
            props: (k) => ({
                ...rowProps,
                title: "Products",
                accessory: <k.Badge label="3 low" intent="warning" />,
                action: { label: "Add product", onPress: noop },
                head: "Name",
                rows: CLIENTS,
                renderRow: (c) => <k.Text>{c.pet}</k.Text>,
                empty: "No products yet.",
            }),
        },
        {
            key: "long",
            title: "Long text and right-to-left names",
            props: (k) => ({
                ...rowProps,
                title: "Clients who haven't booked in the last ninety days",
                summary: "3 of 412 clients, sorted by the date of their last visit",
                action: { label: "Send a reminder", onPress: noop },
                rows: LONG,
                renderRow: (c) => (
                    <k.Stack row>
                        <k.Avatar name={c.name} size="sm" />
                        <k.Text>{`${c.name} · ${c.pet}`}</k.Text>
                        <k.Money cents={c.cents} />
                    </k.Stack>
                ),
                empty: "Everyone has booked recently.",
            }),
        },
        {
            key: "static-rows",
            title: "Rows that don't open",
            props: (k) => ({
                rowKey: (c: Client) => c.id,
                title: "Pets",
                rows: CLIENTS,
                renderRow: (c) => <k.Text>{c.pet}</k.Text>,
                empty: "No pets.",
            }),
        },
        {
            key: "loading",
            title: "Loading",
            props: (k) => ({
                ...rowProps,
                title: "Clients",
                action: { label: "Add client", onPress: noop },
                state: "loading",
                rows: [],
                renderRow: (c) => <k.Text>{c.name}</k.Text>,
                empty: "No clients yet.",
            }),
        },
        {
            key: "error",
            title: "Failed to load, with Try again",
            props: (k) => ({
                ...rowProps,
                title: "Clients",
                state: "error",
                onRetry: noop,
                rows: CLIENTS,
                renderRow: (c) => <k.Text>{c.name}</k.Text>,
                empty: "No clients yet.",
            }),
        },
        {
            key: "rich-empty",
            title: "Empty with an icon, body and action",
            props: (k) => ({
                ...rowProps,
                title: "Clients",
                rows: [],
                renderRow: (c) => <k.Text>{c.name}</k.Text>,
                empty: {
                    icon: "clients",
                    message: "No clients yet",
                    body: "Add your first client, or import a list from your old booking tool.",
                    actions: (
                        <k.Button size="sm" icon="plus" onPress={noop}>
                            Add client
                        </k.Button>
                    ),
                },
            }),
        },
    ],
});
