import type { LoadingProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<LoadingProps>({
    component: "Loading",
    summary: "A loading line, on its own or inline beside other content.",
    controls: { label: { type: "text" }, inline: { type: "boolean" } },
    examples: [
        { key: "default", title: "Default", props: () => ({}) },
        { key: "label", title: "With a label", props: () => ({ label: "Loading clients…" }) },
        { key: "inline", title: "Inline", props: () => ({ label: "Syncing", inline: true }) },
        { key: "inline-bare", title: "Inline without a label", props: () => ({ inline: true }) },
        {
            key: "long",
            title: "Long label",
            props: () => ({
                label: "Loading the last twelve months of sales, refunds and payouts for every location…",
            }),
        },
    ],
});
