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
            key: "attention",
            title: "Everything needs attention, long text",
            props: () => ({
                label: "Before payouts resume",
                items: [
                    {
                        key: "id",
                        label: "Upload a government-issued photo ID for Bartholomew Featherstonehaugh-Montgomery, the account representative",
                        hint: "Stripe could not read the last upload; make sure all four corners are visible and nothing is covered",
                        done: false,
                        attention: true,
                        action: { label: "Upload a new photo", onPress: noop },
                    },
                    {
                        key: "rtl",
                        label: "ليلى حداد: تأكيد الحساب البنكي",
                        hint: "נועה כהן",
                        done: false,
                        attention: true,
                        action: { label: "Confirm", onPress: noop },
                    },
                ],
            }),
        },
        { key: "empty", title: "No items", props: () => ({ label: "Nothing to do", items: [] }) },
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
