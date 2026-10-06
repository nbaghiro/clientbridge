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
            props: () => ({ icon: "info", title: "Synced 2 minutes ago" }),
        },
    ],
});
