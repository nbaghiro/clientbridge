import type { LoadFailedProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

export default story<LoadFailedProps>({
    component: "LoadFailed",
    summary: "The one failed-load state: what didn't load, why it is safe, and Try again.",
    controls: {
        message: { type: "text" },
        body: { type: "text" },
        retrying: { type: "boolean" },
        variant: { type: "select", options: ["inline", "card"] },
    },
    examples: [
        { key: "default", title: "Default copy", props: () => ({ onRetry: noop }) },
        {
            key: "worded",
            title: "Worded for one screen",
            props: () => ({
                message: "Couldn't load today",
                body: "Check your connection. Your schedule on this device is still here once it loads.",
                onRetry: noop,
            }),
        },
        {
            key: "retrying",
            title: "Retrying",
            props: () => ({ onRetry: noop, retrying: true }),
        },
        {
            key: "card",
            title: "Card",
            props: () => ({ variant: "card", onRetry: noop }),
        },
        {
            key: "no-retry",
            title: "Nothing to retry",
            props: () => ({ message: "This link no longer works." }),
        },
    ],
});
