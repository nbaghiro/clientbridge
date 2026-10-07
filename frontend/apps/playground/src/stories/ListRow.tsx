import type { ListRowProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

export default story<ListRowProps>({
    component: "ListRow",
    summary:
        "A pressable row with an icon tile or leading slot, title, detail, meta and trailing actions.",
    controls: {
        title: { type: "text" },
        detail: { type: "text" },
        meta: { type: "text" },
        intent: { type: "select", options: ["neutral", "accent", "success", "warning", "danger"] },
        density: { type: "select", options: ["regular", "compact"] },
        selected: { type: "boolean" },
        unread: { type: "boolean" },
    },
    examples: [
        {
            key: "icon",
            title: "Icon tile",
            props: () => ({
                icon: "receipt",
                intent: "accent",
                title: "Invoice 1148 paid",
                detail: "Amélie Tremblay · Card",
                meta: "9:12 a.m.",
                onPress: noop,
            }),
        },
        {
            key: "intent",
            title: "Danger tint",
            props: () => ({
                icon: "alert",
                intent: "danger",
                title: "Payout failed",
                detail: "Check the bank account in Getting paid",
                onPress: noop,
            }),
        },
        {
            key: "leading",
            title: "Leading avatar",
            props: (k) => ({
                leading: <k.Avatar name="Diego Ruiz" />,
                title: "Diego Ruiz",
                detail: "Mochi · Bath and tidy",
                meta: <k.Money cents={5500} />,
                onPress: noop,
            }),
        },
        {
            key: "trailing",
            title: "Trailing actions",
            props: (k) => ({
                icon: "clock",
                title: "Deposit due",
                detail: "Grace Lin · Thu 2:30 p.m.",
                trailing: (
                    <k.Button size="sm" variant="outline" onPress={noop}>
                        Remind
                    </k.Button>
                ),
            }),
        },
        {
            key: "unread",
            title: "Unread",
            props: () => ({
                unread: true,
                title: "New booking request",
                detail: "Noah Schmidt · Full groom",
                onPress: noop,
            }),
        },
        {
            key: "selected",
            title: "Selected",
            props: () => ({ icon: "clients", title: "Clients", selected: true, onPress: noop }),
        },
        {
            key: "compact",
            title: "Compact",
            props: () => ({
                icon: "user",
                density: "compact",
                title: "Hannah Lee",
                detail: "Owner",
                onPress: noop,
            }),
        },
        {
            key: "static",
            title: "Not pressable",
            props: () => ({ icon: "refresh", title: "Synced 2 minutes ago" }),
        },
        {
            key: "success",
            title: "Success tint",
            props: () => ({
                icon: "check",
                intent: "success",
                title: "Payout sent",
                detail: "$1,284.50 to the account ending 4821",
                meta: "Yesterday",
                onPress: noop,
            }),
        },
        {
            key: "warning",
            title: "Warning tint, compact",
            props: () => ({
                icon: "alert",
                intent: "warning",
                density: "compact",
                title: "Oatmeal shampoo is low",
                meta: "3 left",
                onPress: noop,
            }),
        },
        {
            key: "read",
            title: "Read, keeping the unread gutter",
            props: () => ({
                unread: false,
                title: "Booking confirmed",
                detail: "Grace Lin · Bath and tidy",
                meta: "Mon",
                onPress: noop,
            }),
        },
        {
            key: "selected-trailing",
            title: "Selected with a trailing action",
            props: (k) => ({
                icon: "receipt",
                intent: "accent",
                title: "Invoice 1149",
                detail: "Diego Ruiz · Due Friday",
                selected: true,
                onPress: noop,
                trailing: <k.Badge label="Draft" intent="neutral" />,
            }),
        },
        {
            key: "rich-title",
            title: "Rich title with an accessible name",
            props: (k) => ({
                icon: "star",
                title: (
                    <k.Stack row>
                        <k.Text>Amélie Tremblay</k.Text>
                        <k.Badge label="VIP" intent="accent" />
                    </k.Stack>
                ),
                label: "Amélie Tremblay, VIP",
                detail: "Biscuit · Every 6 weeks",
                onPress: noop,
            }),
        },
        {
            key: "long",
            title: "Long text",
            props: () => ({
                icon: "calendar",
                title: "Full groom with de-shedding treatment, blueberry facial and nail grind for Sir Reginald Biscuit",
                detail: "Maximiliane Alexandra Featherstonehaugh-Wolfeschlegel · Saturday 10:00 a.m. to 1:30 p.m. with Hannah Lee",
                meta: "In 3 days",
                onPress: noop,
            }),
        },
        {
            key: "rtl",
            title: "Right-to-left name",
            props: (k) => ({
                leading: <k.Avatar name="ليلى حداد" />,
                title: "ليلى حداد",
                detail: "بسكويت · قص كامل مع حمام وتجفيف وتنظيف الأذنين",
                meta: <k.Money cents={8500} />,
                onPress: noop,
            }),
        },
    ],
});
