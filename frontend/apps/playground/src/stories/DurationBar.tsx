import type { DurationBarProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<DurationBarProps>({
    component: "DurationBar",
    summary: "How a booking blocks the calendar: buffers either side of the service itself.",
    controls: { caption: { type: "text" }, color: { type: "text" } },
    examples: [
        {
            key: "buffers",
            title: "With buffers",
            props: () => ({
                color: "#2E7A5A",
                caption: "Blocks 2 h 15 min: 15 min setup, 1 h 45 min groom, 15 min clean-up",
                segments: [
                    { key: "before", minutes: 15, label: "Setup", kind: "buffer" },
                    { key: "main", minutes: 105, label: "Full groom", kind: "main" },
                    { key: "after", minutes: 15, label: "Clean-up", kind: "buffer" },
                ],
            }),
        },
        {
            key: "plain",
            title: "No buffers, accent colour",
            props: () => ({
                segments: [{ key: "main", minutes: 30, label: "Nail trim", kind: "main" }],
            }),
        },
        {
            key: "after-only",
            title: "Clean-up only, long caption",
            props: () => ({
                color: "#7A5C99",
                caption:
                    "Blocks 1 h 10 min on the calendar: a one hour blueberry facial and bath, then ten minutes to clean and sanitise the tub before the next client",
                segments: [
                    { key: "main", minutes: 60, label: "Blueberry facial and bath", kind: "main" },
                    { key: "after", minutes: 10, label: "Clean-up", kind: "buffer" },
                ],
            }),
        },
        {
            key: "tiny-buffers",
            title: "Short buffers around a long service",
            props: () => ({
                color: "#B08D57",
                segments: [
                    { key: "before", minutes: 5, label: "Setup", kind: "buffer" },
                    { key: "main", minutes: 240, label: "Hand-strip", kind: "main" },
                    { key: "after", minutes: 5, label: "Clean-up", kind: "buffer" },
                ],
            }),
        },
        {
            key: "rtl",
            title: "Right-to-left labels",
            props: () => ({
                color: "#2E7A5A",
                caption: "يحجز ساعة و٣٠ دقيقة",
                segments: [
                    { key: "before", minutes: 15, label: "تحضير", kind: "buffer" },
                    { key: "main", minutes: 60, label: "قص الأظافر والاستحمام", kind: "main" },
                    { key: "after", minutes: 15, label: "تنظيف", kind: "buffer" },
                ],
            }),
        },
    ],
});
