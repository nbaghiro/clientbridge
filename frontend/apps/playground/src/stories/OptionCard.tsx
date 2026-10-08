import type { OptionCardProps } from "@clientbridge/app-core";
import { story, noop } from "../story";
export default story<OptionCardProps>({
    component: "OptionCard",
    summary: "Client-facing choices and actions for Connect.",
    controls: {
        layout: { type: "select", options: ["row", "stack"] },
        size: { type: "select", options: ["sm", "md", "lg"] },
        selected: { type: "boolean" },
    },
    examples: [
        {
            key: "default",
            title: "Service",
            props: () => ({
                title: "Full groom",
                subtitle: "60 minutes",
                detail: "Bath, brush, trim and nail care",
                onPress: noop,
            }),
        },
        {
            key: "selected",
            title: "Selected",
            props: () => ({ title: "Full groom", selected: true, onPress: noop }),
        },
        {
            key: "disabled",
            title: "Unavailable",
            props: () => ({ title: "Full groom", disabled: true }),
        },
        {
            key: "stack",
            title: "Product card",
            props: (kit) => ({
                title: "Gentle shampoo",
                layout: "stack",
                leading: <kit.Icon name="bag" size={48} />,
                trailing: <kit.Money cents={2400} />,
                onPress: noop,
            }),
        },
    ],
});
