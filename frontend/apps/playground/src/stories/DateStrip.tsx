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
    controls: {
        label: { type: "text" },
        prevLabel: { type: "text" },
        nextLabel: { type: "text" },
    },
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
        {
            key: "controlled",
            title: "Controlled",
            state: { value: "value", onChange: "onChange" },
            props: () => ({
                label: "Pick a day",
                days: WEEK,
                value: "2026-10-08",
                onPrev: noop,
                onNext: noop,
                prevLabel: "Previous week",
                nextLabel: "Next week",
            }),
        },
        {
            key: "none",
            title: "Nothing chosen, all closed but one",
            props: () => ({
                label: "Pick a day",
                days: WEEK.map((d) =>
                    d.key === "2026-10-09" ? d : { ...d, closed: true, busy: 0 },
                ),
                value: null,
            }),
        },
        {
            key: "rtl",
            title: "Right-to-left weekday names",
            props: () => ({
                label: "اختر يومًا",
                days: [
                    { key: "a", weekday: "الإثنين", day: "٥", closed: true },
                    { key: "b", weekday: "الثلاثاء", day: "٦", busy: 3, isToday: true },
                    { key: "c", weekday: "الأربعاء", day: "٧", busy: 2 },
                    { key: "d", weekday: "الخميس", day: "٨", busy: 1 },
                    { key: "e", weekday: "الجمعة", day: "٩" },
                ],
                defaultValue: "b",
            }),
        },
    ],
});
