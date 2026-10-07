import type { ConfirmOptions } from "@clientbridge/app-core";

import { story } from "../story";

export default [
    story<ConfirmOptions>({
        component: "confirm",
        summary:
            "Asks a yes or no question: the app's dialog on web (ConfirmHost), the system alert on mobile.",
        controls: {
            title: { type: "text" },
            confirmLabel: { type: "text" },
            destructive: { type: "boolean" },
        },
        render: (k, props) => (
            <k.Button
                variant={props.destructive === true ? "danger" : "outline"}
                onPress={() => {
                    k.confirm(props).catch(() => undefined);
                }}
            >
                {props.confirmLabel}
            </k.Button>
        ),
        examples: [
            {
                key: "destructive",
                title: "Destructive",
                props: () => ({
                    title: "Void invoice 1148?",
                    message: "The client keeps a copy marked void.",
                    confirmLabel: "Void invoice",
                    destructive: true,
                }),
            },
            {
                key: "long",
                title: "Long message",
                props: () => ({
                    title: "Cancel all 12 upcoming visits for Bartholomew Featherstonehaugh-Montgomery?",
                    message:
                        "Each client gets a cancellation text and any deposits are refunded to the card they paid with. Visits already checked in stay on the calendar.",
                    confirmLabel: "Cancel 12 visits",
                    cancelLabel: "Keep them",
                    destructive: true,
                }),
            },
            {
                key: "rtl",
                title: "Right-to-left text",
                props: () => ({
                    title: "למחוק את הלקוחה נועה כהן?",
                    message: "ليلى حداد",
                    confirmLabel: "מחיקה",
                    destructive: true,
                }),
            },
            {
                key: "plain",
                title: "Plain question",
                props: () => ({
                    title: "Send reminders to 4 clients?",
                    confirmLabel: "Send",
                    cancelLabel: "Not now",
                }),
            },
        ],
    }),
];
