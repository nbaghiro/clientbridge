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
    ],
});
