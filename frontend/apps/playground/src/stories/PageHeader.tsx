import type { PageHeaderProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

export default story<PageHeaderProps>({
    component: "PageHeader",
    summary:
        "A page title and subtitle with actions, and an optional row under it for tabs or filters.",
    controls: { title: { type: "text" }, subtitle: { type: "text" } },
    examples: [
        { key: "title", title: "Title only", props: () => ({ title: "Payments" }) },
        {
            key: "subtitle-actions",
            title: "Subtitle and actions",
            props: (k) => ({
                title: "Clients",
                subtitle: "12 total",
                actions: (
                    <k.Button icon="plus" onPress={noop}>
                        Add client
                    </k.Button>
                ),
            }),
        },
        {
            key: "children",
            title: "With a row underneath",
            props: (k) => ({
                title: "Inbox",
                children: (
                    <k.Stack row>
                        <k.Badge label="Messages" />
                        <k.Badge label="Reviews" intent="neutral" />
                    </k.Stack>
                ),
            }),
        },
        {
            key: "several-actions",
            title: "Several actions and a row",
            props: (k) => ({
                title: "Schedule",
                subtitle: "Tuesday, October 6",
                actions: (
                    <>
                        <k.Button variant="outline" onPress={noop}>
                            Today
                        </k.Button>
                        <k.Button icon="plus" onPress={noop}>
                            Book
                        </k.Button>
                    </>
                ),
                children: <k.Badge label="3 requests waiting" intent="warning" />,
            }),
        },
        {
            key: "long",
            title: "Long title and subtitle",
            props: (k) => ({
                title: "Maximiliane Alexandra Featherstonehaugh-Wolfeschlegel",
                subtitle:
                    "Client since March 2021 · 3 pets · Prefers text messages in the afternoon after school pickup",
                actions: (
                    <k.Button variant="outline" onPress={noop}>
                        Edit
                    </k.Button>
                ),
            }),
        },
        {
            key: "rtl",
            title: "Right-to-left title",
            props: () => ({ title: "ليلى حداد", subtitle: "عميلة منذ ٢٠٢١" }),
        },
    ],
});
