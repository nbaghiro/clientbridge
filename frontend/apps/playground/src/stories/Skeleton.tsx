import type { SkeletonProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<SkeletonProps>({
    component: "Skeleton",
    summary: "Placeholder rows, stats or lines while content loads.",
    controls: {
        variant: { type: "select", options: ["row", "stat", "line"] },
        count: { type: "number", min: 1, max: 8 },
        columns: { type: "number", min: 2, max: 4 },
    },
    examples: [
        {
            key: "rows",
            title: "Rows",
            props: () => ({ variant: "row", count: 4, label: "Loading clients" }),
        },
        {
            key: "stats",
            title: "Stats in a row",
            props: () => ({ variant: "stat", count: 3, columns: 3, label: "Loading totals" }),
        },
        {
            key: "lines",
            title: "Lines",
            props: () => ({ variant: "line", count: 3, label: "Loading notes" }),
        },
        {
            key: "stats-two",
            title: "Stats, two columns",
            props: () => ({ variant: "stat", count: 4, columns: 2, label: "Loading totals" }),
        },
        {
            key: "stats-four",
            title: "Stats, four columns (two on narrow screens)",
            props: () => ({ variant: "stat", count: 4, columns: 4, label: "Loading totals" }),
        },
        {
            key: "stat-stacked",
            title: "Stats, stacked",
            props: () => ({ variant: "stat", count: 2, label: "Loading totals" }),
        },
        { key: "single", title: "One row", props: () => ({ variant: "row", label: "Loading" }) },
    ],
});
