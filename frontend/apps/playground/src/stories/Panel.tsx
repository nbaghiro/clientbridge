import type { PanelProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

export default story<PanelProps>({
    component: "Panel",
    summary: "A card with an optional title, subtitle and actions; flush runs a list edge to edge.",
    controls: { title: { type: "text" }, subtitle: { type: "text" }, flush: { type: "boolean" } },
    examples: [
        {
            key: "titled",
            title: "Title and subtitle",
            props: (k) => ({
                title: "Business details",
                subtitle: "Shown on invoices and receipts.",
                children: <k.Text>Birchbark Pet Studio · 1820 Cook St, Victoria</k.Text>,
            }),
        },
        {
            key: "actions",
            title: "With actions",
            props: (k) => ({
                title: "Staff",
                actions: (
                    <k.Button size="sm" variant="outline" onPress={noop}>
                        Invite
                    </k.Button>
                ),
                children: (
                    <k.Stack row>
                        <k.Avatar name="Hannah Lee" />
                        <k.Avatar name="Priya Shah" color="#2E7A5A" />
                    </k.Stack>
                ),
            }),
        },
        {
            key: "flush",
            title: "Flush",
            props: (k) => ({
                title: "Recent activity",
                flush: true,
                children: <k.Text tone="muted">Rows run edge to edge here.</k.Text>,
            }),
        },
        {
            key: "bare",
            title: "No header",
            props: (k) => ({ children: <k.Text>Just content.</k.Text> }),
        },
    ],
});
