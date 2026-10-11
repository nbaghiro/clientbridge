import type { MoneyProps } from "@clientbridge/app-core";

import { story } from "../story";

// A story-only prop: several amounts stacked, to check digit alignment and the separators.
type MoneyStory = MoneyProps & { column?: readonly number[] };

export default story<MoneyStory>({
    component: "Money",
    render: (k, { column, ...props }) =>
        column ? (
            <k.Stack end>
                {column.map((cents) => (
                    <k.Money key={cents} {...props} cents={cents} />
                ))}
            </k.Stack>
        ) : (
            <k.Money {...props} />
        ),
    summary: "An amount in cents, in tabular figures, in one of four tones.",
    controls: {
        cents: { type: "number", step: 100 },
        tone: { type: "select", options: ["ink", "muted", "success", "danger"] },
        strong: { type: "boolean" },
    },
    examples: [
        { key: "default", title: "Default", props: () => ({ currency: "CAD", cents: 8500 }) },
        {
            key: "strong",
            title: "Strong",
            props: () => ({ currency: "CAD", cents: 214592, strong: true }),
        },
        {
            key: "muted",
            title: "Muted",
            props: () => ({ currency: "CAD", cents: 1410, tone: "muted" }),
        },
        {
            key: "success",
            title: "Success",
            props: () => ({ currency: "CAD", cents: 5040, tone: "success" }),
        },
        {
            key: "danger",
            title: "Danger",
            props: () => ({ currency: "CAD", cents: 35616, tone: "danger" }),
        },
        { key: "zero", title: "Zero", props: () => ({ currency: "CAD", cents: 0 }) },
        { key: "null", title: "No amount", props: () => ({ currency: "CAD", cents: null }) },
        {
            key: "column",
            title: "A column of amounts",
            props: () => ({ currency: "CAD", cents: null, column: [7500, 128450, 99, 1234567] }),
        },
        {
            key: "negative",
            title: "Negative (a refund)",
            props: () => ({ currency: "CAD", cents: -4250, tone: "danger" }),
        },
        {
            key: "large",
            title: "Large and strong",
            props: () => ({ currency: "CAD", cents: 123456789, strong: true, tone: "success" }),
        },
    ],
});
