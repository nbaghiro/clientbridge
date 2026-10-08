import type { ActionTileProps } from "@clientbridge/app-core";
import { story, noop } from "../story";
export default story<ActionTileProps>({
    component: "ActionTile",
    summary: "Client-facing choices and actions for Connect.",
    controls: {
        layout: { type: "select", options: ["tile", "row"] },
        variant: { type: "select", options: ["plain", "inverse"] },
    },
    examples: [
        {
            key: "default",
            title: "Calendar action",
            props: () => ({
                icon: "calendar",
                label: "Add to calendar",
                hint: "Save your visit",
                onPress: noop,
            }),
        },
        {
            key: "inverse",
            title: "On brand",
            backdrop: "brand",
            props: () => ({
                icon: "message",
                label: "Message us",
                variant: "inverse",
                layout: "row",
                onPress: noop,
            }),
        },
        {
            key: "disabled",
            title: "Unavailable",
            props: () => ({ icon: "calendar", label: "Add to calendar", disabled: true }),
        },
    ],
});
