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
