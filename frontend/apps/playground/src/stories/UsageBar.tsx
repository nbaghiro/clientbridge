import type { UsageBarProps } from "@clientbridge/app-core";

import { story } from "../story";

const TICKS = [0, 120, 240, 360, 480].map((at, i) => ({
    at,
    label: ["9", "11", "1", "3", "5"][i] ?? "",
}));

export default story<UsageBarProps>({
    component: "UsageBar",
    summary: "A day of a room or station: bookings as coloured spans, hour ticks and a now line.",
    controls: { now: { type: "number", min: 0, max: 480, step: 15 } },
    examples: [
        {
            key: "default",
            title: "Grooming table 1",
            props: () => ({
                total: 480,
                now: 150,
                ticks: TICKS,
                label: "Grooming table 1, 3 bookings",
                segments: [
                    { key: "a", from: 0, to: 90, color: "#3F5E80", label: "Biscuit" },
                    { key: "b", from: 120, to: 210, color: "#2E7A5A", label: "Juniper" },
                    { key: "c", from: 300, to: 390, color: "#B4562A", label: "Maple" },
                ],
            }),
        },
        {
            key: "empty",
            title: "Free all day",
            props: () => ({ total: 480, ticks: TICKS, segments: [], label: "Bath station, free" }),
        },
        {
            key: "full",
            title: "Fully booked, no ticks",
            props: () => ({
                total: 480,
                label: "Grooming table 2, full",
                segments: [
                    { key: "a", from: 0, to: 240, color: "#7A4E8C", label: "Daycare group" },
                    { key: "b", from: 240, to: 480, color: "#2F7F8A", label: "Puppy class" },
                ],
            }),
        },
    ],
});
