import type { ChecklistProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

export default story<ChecklistProps>({
    component: "Checklist",
    summary: "Steps to finish, each done, open or needing attention, with an action.",
    controls: { label: { type: "text" } },
    examples: [
        {
            key: "setup",
            title: "Getting set up",
            props: () => ({
                label: "Getting set up",
                items: [
                    {
                        key: "profile",
                        label: "Add your business details",
                        done: true,
                        action: { label: "Edit", onPress: noop },
                    },
                    { key: "services", label: "Add your services", hint: "3 added", done: true },
                    {
                        key: "stripe",
                        label: "Verify your identity with Stripe",
                        hint: "Payouts are paused until this is done",
                        done: false,
                        attention: true,
                        action: { label: "Verify", onPress: noop },
                    },
                    {
                        key: "hours",
                        label: "Set your hours",
                        done: false,
                        action: { label: "Set hours", onPress: noop },
                    },
                ],
            }),
        },
        {
            key: "all-done",
            title: "All done",
            props: () => ({
                label: "Before the first booking",
                items: [
                    { key: "a", label: "Deposit policy", done: true },
                    { key: "b", label: "Cancellation policy", done: true },
                ],
            }),
        },
    ],
});
