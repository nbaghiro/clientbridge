import type { DayRailProps } from "@clientbridge/app-core";
import { story, noop } from "../story";
export default story<DayRailProps>({
    component: "DayRail",
    summary: "Client-facing choices and actions for Connect.",
    examples: [
        {
            key: "default",
            title: "Availability",
            state: { value: "value", onChange: "onChange" },
            props: () => ({
                label: "Choose a day",
                value: "2026-10-08",
                days: [
                    { key: "2026-10-07", weekday: "Wed", day: "7", hint: "Full", disabled: true },
                    { key: "2026-10-08", weekday: "Thu", day: "8", hint: "4 times" },
                    { key: "2026-10-09", weekday: "Fri", day: "9", hint: "2 times" },
                ],
                onPrev: noop,
                onNext: noop,
            }),
        },
    ],
});
