import type { MoneyProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<MoneyProps>({
    component: "Money",
    summary: "An amount in cents, in tabular figures, in one of four tones.",
    controls: {
        cents: { type: "number", step: 100 },
        tone: { type: "select", options: ["ink", "muted", "success", "danger"] },
        strong: { type: "boolean" },
    },
    examples: [
        { key: "default", title: "Default", props: () => ({ cents: 8500 }) },
        { key: "strong", title: "Strong", props: () => ({ cents: 214592, strong: true }) },
        { key: "muted", title: "Muted", props: () => ({ cents: 1410, tone: "muted" }) },
        { key: "success", title: "Success", props: () => ({ cents: 5040, tone: "success" }) },
        { key: "danger", title: "Danger", props: () => ({ cents: 35616, tone: "danger" }) },
        { key: "zero", title: "Zero", props: () => ({ cents: 0 }) },
        { key: "null", title: "No amount", props: () => ({ cents: null }) },
    ],
});
