import type { CalendarEventCardProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

const base: CalendarEventCardProps = {
    headline: "Biscuit · Full groom",
    detail: "Amélie Tremblay",
    time: "9:30 – 11:00 a.m.",
    intent: "accent",
    color: "#2E7A5A",
    label: "Biscuit, full groom with Amélie Tremblay, 9:30 to 11:00 a.m.",
    onPress: noop,
};

export default story<CalendarEventCardProps>({
    component: "CalendarEventCard",
    summary: "A visit on the calendar: status fill and edge, the service swatch and flags.",
    controls: {
        headline: { type: "text" },
        intent: { type: "select", options: ["accent", "success", "warning", "danger", "neutral"] },
        density: { type: "select", options: ["compact", "regular", "full"] },
        state: { type: "select", options: ["idle", "selected", "dragging", "refused", "faded"] },
    },
    examples: [
        { key: "full", title: "Full", props: () => ({ ...base, flags: ["online", "note"] }) },
        { key: "regular", title: "Regular", props: () => ({ ...base, density: "regular" }) },
        {
            key: "compact",
            title: "Compact",
            props: () => ({ ...base, density: "compact", time: "9:30" }),
        },
        {
            key: "pending",
            title: "Pending (warning)",
            props: () => ({ ...base, intent: "warning", flags: ["deposit_due"] }),
        },
        {
            key: "done",
            title: "Done",
            props: () => ({ ...base, intent: "success", state: "faded" }),
        },
        {
            key: "selected",
            title: "Selected",
            props: () => ({ ...base, state: "selected", flags: ["recurring", "addons"] }),
        },
        { key: "dragging", title: "Dragging", props: () => ({ ...base, state: "dragging" }) },
        {
            key: "refused",
            title: "Refused drop",
            props: () => ({ ...base, intent: "danger", state: "refused" }),
        },
        {
            key: "neutral",
            title: "Neutral (blocked time), no swatch",
            props: () => ({
                ...base,
                headline: "Lunch",
                detail: undefined,
                intent: "neutral",
                color: null,
                onPress: undefined,
            }),
        },
        {
            key: "compact-refused",
            title: "Compact, refused",
            props: () => ({
                ...base,
                density: "compact",
                time: "9:30",
                intent: "danger",
                state: "refused",
            }),
        },
        {
            key: "all-flags",
            title: "Every flag",
            props: () => ({
                ...base,
                flags: ["online", "recurring", "deposit_due", "addons", "note", "walk_in", "class"],
            }),
        },
        {
            key: "long",
            title: "Long text (truncates)",
            props: () => ({
                ...base,
                headline:
                    "Bartholomew Featherstonehaugh-Montgomery · Full groom, nail trim, teeth and a bow",
                detail: "Amélie Tremblay-Gagnon-Featherstonehaugh, second pet in the same visit",
                flags: ["online", "note", "addons"],
            }),
        },
        {
            key: "rtl",
            title: "Right-to-left names",
            props: () => ({
                ...base,
                headline: "ليلى حداد · טיפוח מלא",
                detail: "נועה כהן",
                density: "regular",
            }),
        },
        {
            key: "class",
            title: "Class with walk-ins",
            props: () => ({
                ...base,
                headline: "Puppy social",
                detail: "6 of 8",
                flags: ["class", "walk_in"],
            }),
        },
    ],
});
