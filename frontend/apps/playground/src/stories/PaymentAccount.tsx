import { type PaymentAccountProps, strings } from "@clientbridge/app-core";

import { noop, story } from "../story";

export default story<PaymentAccountProps>({
    component: "PaymentAccount",
    summary:
        "Embedded payment onboarding, account management, disputes and payouts, with a disconnected preview.",
    controls: {
        component: { type: "select", options: ["onboarding", "account", "payments", "payouts"] },
    },
    examples: [
        {
            key: "disconnected",
            title: strings.paymentAccount.account,
            props: () => ({
                component: "account",
                scope: "preview",
                preview: true,
                fetchClientSecret: () => Promise.reject(new Error(strings.paymentAccount.preview)),
                onClose: noop,
            }),
        },
    ],
});
