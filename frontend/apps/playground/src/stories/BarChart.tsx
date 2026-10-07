import type { BarChartProps } from "@clientbridge/app-core";

import { story } from "../story";

const MONTHS = ["May", "Jun", "Jul", "Aug", "Sep", "Oct"];
const VALUES = [8120, 9340, 11020, 10480, 12210, 4310];

export default story<BarChartProps>({
    component: "BarChart",
    summary: "One series of bars over time, with partial and out-of-range periods drawn lighter.",
    controls: { label: { type: "text" }, height: { type: "number", min: 80, max: 320, step: 20 } },
    examples: [
        {
            key: "months",
            title: "Net sales by month",
            props: () => ({
                label: "Net sales by month",
                bars: MONTHS.map((m, i) => ({
                    key: m,
                    label: m,
                    value: VALUES[i] ?? 0,
                    valueLabel: `$${(VALUES[i] ?? 0).toLocaleString("en-CA")}`,
                    partial: i === MONTHS.length - 1,
                })),
            }),
        },
        {
            key: "dim",
            title: "Context outside the period",
            props: () => ({
                label: "Weekly sales",
                height: 120,
                bars: ["W36", "W37", "W38", "W39", "W40"].map((w, i) => ({
                    key: w,
                    label: w,
                    value: 1800 + i * 240,
                    valueLabel: `$${String(1800 + i * 240)}`,
                    dim: i < 2,
                })),
            }),
        },
        {
            key: "year",
            title: "Twelve months, tall",
            props: () => ({
                label: "Bookings by month",
                height: 220,
                bars: ["Nov", "Dec", "Jan", "Feb", "Mar", "Apr", ...MONTHS].map((m, i) => ({
                    key: m,
                    label: m,
                    value: 40 + ((i * 37) % 60),
                    valueLabel: `${String(40 + ((i * 37) % 60))} bookings`,
                })),
            }),
        },
        {
            key: "single",
            title: "One bar, long label",
            props: () => ({
                label: "This week",
                height: 100,
                bars: [
                    {
                        key: "w",
                        label: "Week of Oct 5 to Oct 11",
                        value: 2760,
                        valueLabel: "$2,760",
                        partial: true,
                    },
                ],
            }),
        },
        {
            key: "empty",
            title: "All zero",
            props: () => ({
                label: "No sales yet",
                bars: MONTHS.map((m) => ({ key: m, label: m, value: 0, valueLabel: "$0" })),
            }),
        },
    ],
});
