import type { WeeklyHoursDay, WeeklyHoursEditorProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

const NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const DAYS: WeeklyHoursDay[] = NAMES.map((label, i) => ({
    weekday: i,
    label,
    short: label.slice(0, 3),
    open: i < 5,
    start: "09:00",
    end: "17:00",
    hours: 8,
    error: null,
}));

const TIMES = Array.from({ length: 25 }, (_, i) => {
    const h = 7 + Math.floor(i / 2);
    const m = i % 2 === 0 ? "00" : "30";
    return {
        key: `${String(h).padStart(2, "0")}:${m}`,
        label: `${String(h > 12 ? h - 12 : h)}:${m} ${h < 12 ? "a.m." : "p.m."}`,
    };
});

const base = {
    timeOptions: TIMES,
    onOpen: noop,
    onTime: noop,
    copyLabel: "Copy Monday to all weekdays",
    closedLabel: "Closed",
    toLabel: "to",
    hoursLabel: (h: number) => `${String(h)} h`,
};

export default story<WeeklyHoursEditorProps>({
    component: "WeeklyHoursEditor",
    summary:
        "One person's regular week: a row per day with open or closed and start and end times.",
    examples: [
        {
            key: "default",
            title: "Weekdays open",
            props: () => ({ ...base, days: DAYS, onCopy: noop }),
        },
        {
            key: "error",
            title: "With an error",
            props: () => ({
                ...base,
                days: DAYS.map((d) =>
                    d.weekday === 2
                        ? {
                              ...d,
                              start: "17:00",
                              end: "09:00",
                              hours: 0,
                              error: "End must be after start",
                          }
                        : d,
                ),
            }),
        },
        {
            key: "closed",
            title: "All closed",
            props: () => ({ ...base, days: DAYS.map((d) => ({ ...d, open: false })) }),
        },
    ],
});
