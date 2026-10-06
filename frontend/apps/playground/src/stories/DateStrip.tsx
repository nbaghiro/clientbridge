import type { DateStripDay, DateStripProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

const WEEK: readonly DateStripDay[] = [
    { key: "2026-10-05", weekday: "Mon", day: "5", closed: true },
    { key: "2026-10-06", weekday: "Tue", day: "6", busy: 3, isToday: true },
    { key: "2026-10-07", weekday: "Wed", day: "7", busy: 2 },
    { key: "2026-10-08", weekday: "Thu", day: "8", busy: 1 },
    { key: "2026-10-09", weekday: "Fri", day: "9", busy: 3 },
    { key: "2026-10-10", weekday: "Sat", day: "10", disabled: true },
    { key: "2026-10-11", weekday: "Sun", day: "11", closed: true },
];

export default story<DateStripProps>({
    component: "DateStrip",
    summary: "A week of dates with how busy each one is; closed days can't be picked.",
    controls: { label: { type: "text" } },
    examples: [
        {
            key: "week",
            title: "Week with navigation",
            props: () => ({
                label: "Pick a day",
                days: WEEK,
                defaultValue: "2026-10-06",
                onPrev: noop,
                onNext: noop,
            }),
        },
        {
            key: "plain",
            title: "Without navigation",
            props: () => ({ label: "Pick a day", days: WEEK.slice(1, 6) }),
        },
    ],
});
