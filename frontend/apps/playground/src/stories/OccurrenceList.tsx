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
        {
            key: "conflicts",
            title: "Refused dates and long notes",
            props: () => ({
                label: "Puppy class series",
                onAction: noop,
                rows: [
                    {
                        key: "1",
                        index: 1,
                        date: "Saturday, November 14",
                        time: "10:00 a.m.",
                        intent: "danger",
                        state: "Can't book",
                        note: "The studio is closed for the Remembrance Day long weekend, and Hannah Lee is away until the following Tuesday",
                        actions: [
                            { key: "next", label: "Move to Sunday, November 15 at 10:00 a.m." },
                            { key: "skip", label: "Skip this one", selected: true },
                        ],
                    },
                    {
                        key: "2",
                        index: 12,
                        date: "Saturday, November 21",
                        time: "10:00 a.m.",
                        intent: "accent",
                        state: "Booked",
                        flag: "Clocks changed: still 10:00 a.m. local",
                    },
                ],
            }),
        },
        {
            key: "rtl",
            title: "Right-to-left note",
            props: () => ({
                label: "حمام أسبوعي",
                rows: [
                    {
                        key: "1",
                        index: 1,
                        date: "Fri, Oct 9",
                        time: "9:00 a.m.",
                        intent: "warning",
                        state: "Clash",
                        note: "هناء في إجازة في ذلك اليوم",
                    },
                ],
            }),
        },
        {
            key: "empty",
            title: "No dates",
            props: () => ({ label: "Nothing scheduled", rows: [] }),
        },
    ],
});
