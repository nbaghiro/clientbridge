import type { RatingDistributionProps } from "@clientbridge/app-core";

import { story } from "../story";

const label = (stars: number, count: number): string =>
    `${String(stars)} stars: ${String(count)} review${count === 1 ? "" : "s"}`;

export default story<RatingDistributionProps>({
    component: "RatingDistribution",
    summary: "How ratings spread from five stars down to one.",
    examples: [
        {
            key: "default",
            title: "Mostly five stars",
            props: () => ({
                rows: [
                    { stars: 5, count: 42 },
                    { stars: 4, count: 9 },
                    { stars: 3, count: 2 },
                    { stars: 2, count: 1 },
                    { stars: 1, count: 0 },
                ],
                label,
            }),
        },
        {
            key: "mixed",
            title: "Mixed",
            props: () => ({
                rows: [
                    { stars: 5, count: 6 },
                    { stars: 4, count: 7 },
                    { stars: 3, count: 4 },
                    { stars: 2, count: 3 },
                    { stars: 1, count: 2 },
                ],
                label,
            }),
        },
        {
            key: "empty",
            title: "No reviews yet",
            props: () => ({ rows: [5, 4, 3, 2, 1].map((stars) => ({ stars, count: 0 })), label }),
        },
    ],
});
