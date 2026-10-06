import type { SkeletonProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<SkeletonProps>({
    component: "Skeleton",
    summary: "Placeholder rows, stats or lines while content loads.",
    controls: {
        variant: { type: "select", options: ["row", "stat", "line"] },
        count: { type: "number", min: 1, max: 8 },
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
        { key: "single", title: "One row", props: () => ({ variant: "row", label: "Loading" }) },
    ],
});
