import type { CardFormProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

export default story<CardFormProps>({
    component: "CardForm",
    summary:
        "Card entry that confirms a charge or saves a card; Stripe isn't set up here, so it shows its fallback.",
    controls: {
        submitLabel: { type: "text" },
        mode: { type: "select", options: ["payment", "setup"] },
    },
    examples: [
        {
            key: "framed",
            title: "Framed, with cancel",
            props: () => ({
                clientSecret: "pi_demo_secret",
                stripeAccount: "acct_demo",
                submitLabel: "Charge $84.00",
                busyLabel: "Charging…",
                onDone: noop,
                onCancel: noop,
            }),
        },
        {
            key: "bare",
            title: "Bare public form",
            props: () => ({
                clientSecret: "seti_demo_secret",
                stripeAccount: "acct_demo",
                mode: "setup",
                submitLabel: "Save card",
                busyLabel: "Saving…",
                onDone: noop,
            }),
        },
    ],
});
