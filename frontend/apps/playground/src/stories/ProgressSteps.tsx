import type { ProgressStep, ProgressStepsProps } from "@clientbridge/app-core";

import { story } from "../story";

const booking: ProgressStep[] = [
    { key: "service", label: "Service", state: "done" },
    { key: "time", label: "Time", state: "current" },
    { key: "details", label: "Your details", state: "todo" },
    { key: "pay", label: "Deposit", state: "todo" },
];

const payouts: ProgressStep[] = [
    {
        key: "business",
        label: "Business details",
        hint: "Birchbark Pet Studio, Victoria BC",
        state: "done",
    },
    { key: "bank", label: "Bank account", hint: "RBC ending 4821", state: "done" },
    {
        key: "identity",
        label: "Verify your identity",
        hint: "Stripe needs a photo ID before payouts start.",
        state: "blocked",
    },
    {
        key: "first",
        label: "First payout",
        hint: "Two business days after your first sale.",
        state: "todo",
    },
];

const longSteps: ProgressStep[] = [
    { key: "a", label: "Choose a service and any add-ons for your pet", state: "done" },
    { key: "b", label: "Pick a time that suits your schedule", state: "current" },
    { key: "c", label: "Tell us about your pet's temperament and health", state: "todo" },
    { key: "d", label: "Pay a deposit to hold the booking", state: "todo" },
];

const rtlSteps: ProgressStep[] = [
    { key: "a", label: "בחירת שירות", hint: "תספורת מלאה לכלב", state: "done" },
    { key: "b", label: "בחירת שעה", hint: "יום שלישי, 14:30", state: "current" },
    { key: "c", label: "פרטים אישיים", state: "todo" },
];

export default story<ProgressStepsProps>({
    component: "ProgressSteps",
    summary: "Where someone is in a flow: a compact wizard header or a timeline with hints.",
    controls: { layout: { type: "select", options: ["row", "column"] }, label: { type: "text" } },
    examples: [
        { key: "row", title: "Row", props: () => ({ steps: booking, label: "Booking steps" }) },
        {
            key: "column",
            title: "Column with hints",
            props: () => ({ steps: payouts, layout: "column", label: "Payout setup" }),
        },
        {
            key: "row-blocked",
            title: "Row with a blocked step",
            props: () => ({
                steps: payouts.map((s) => ({ ...s, hint: undefined })),
                label: "Payout setup",
            }),
        },
        {
            key: "row-long",
            title: "Row, long labels truncate",
            props: () => ({ steps: longSteps, label: "Booking steps" }),
        },
        {
            key: "column-long",
            title: "Column, long labels wrap",
            props: () => ({ steps: longSteps, layout: "column", label: "Booking steps" }),
        },
        {
            key: "rtl",
            title: "Hebrew labels",
            props: () => ({ steps: rtlSteps, layout: "column", label: "שלבי הזמנה" }),
        },
        {
            key: "all-done",
            title: "All done",
            props: () => ({
                steps: booking.map((s) => ({ ...s, state: "done" as const })),
                label: "Booking steps",
            }),
        },
        {
            key: "start",
            title: "First step",
            props: () => ({
                steps: booking.map((s, i) => ({
                    ...s,
                    state: i === 0 ? ("current" as const) : ("todo" as const),
                })),
                layout: "column",
                label: "Booking steps",
            }),
        },
    ],
});
