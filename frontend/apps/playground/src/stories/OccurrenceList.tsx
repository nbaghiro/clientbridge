import type { OccurrenceListProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

export default story<OccurrenceListProps>({
    component: "OccurrenceList",
    summary: "The dates of a repeating booking, each with its state, and the ways out of a clash.",
    controls: { label: { type: "text" } },
    examples: [
        {
            key: "series",
            title: "A series with a clash",
            props: () => ({
                label: "Biscuit's monthly groom",
                onAction: noop,
                rows: [
                    {
                        key: "1",
                        index: 1,
                        date: "Tue, Sep 8",
                        time: "10:00 a.m.",
                        intent: "success",
                        state: "Done",
                        past: true,
                    },
                    {
                        key: "2",
                        index: 2,
                        date: "Tue, Oct 6",
                        time: "10:00 a.m.",
                        intent: "accent",
                        state: "Booked",
                    },
                    {
                        key: "3",
                        index: 3,
                        date: "Tue, Nov 3",
                        time: "10:00 a.m.",
                        intent: "warning",
                        state: "Clash",
                        note: "Hannah is off that day",
                        actions: [
                            { key: "shift", label: "Move to 1:00 p.m.", selected: true },
                            { key: "skip", label: "Skip this one" },
                        ],
                    },
                    {
                        key: "4",
                        index: 4,
                        date: "Tue, Dec 1",
                        time: "10:00 a.m.",
                        intent: "accent",
                        state: "Booked",
                        flag: "Clocks change: still 10:00 a.m. local",
                    },
                    {
                        key: "5",
                        index: 5,
                        date: "Tue, Dec 29",
                        time: "10:00 a.m.",
                        intent: "neutral",
                        state: "Skipped",
                    },
                ],
            }),
        },
        {
            key: "plain",
            title: "All booked",
            props: () => ({
                label: "Mochi's weekly bath",
                rows: [
                    {
                        key: "1",
                        index: 1,
                        date: "Fri, Oct 9",
                        time: "9:00 a.m.",
                        intent: "accent",
                        state: "Booked",
                    },
                    {
                        key: "2",
                        index: 2,
                        date: "Fri, Oct 16",
                        time: "9:00 a.m.",
                        intent: "accent",
                        state: "Booked",
                    },
                ],
            }),
        },
    ],
});
