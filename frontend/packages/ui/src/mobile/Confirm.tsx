import { type ConfirmOptions, strings } from "@clientbridge/app-core";
import { Alert } from "react-native";

/** The system alert on mobile; resolves false when cancelled. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
        Alert.alert(
            options.title,
            options.message,
            [
                {
                    text: options.cancelLabel ?? strings.common.cancel,
                    style: "cancel",
                    onPress: () => {
                        resolve(false);
                    },
                },
                {
                    text: options.confirmLabel,
                    style: options.destructive === true ? "destructive" : "default",
                    onPress: () => {
                        resolve(true);
                    },
                },
            ],
            {
                cancelable: true,
                onDismiss: () => {
                    resolve(false);
                },
            },
        );
    });
}

/** Mobile alerts need no host; kept so both apps mount the same root. */
export function ConfirmHost() {
    return null;
}
