import type { AddPaymentMethod, PaymentMethodFormProps } from "@clientbridge/app-core";

import { noop, story } from "../story";

const flow = (over: Partial<AddPaymentMethod>): AddPaymentMethod => ({
    kind: null,
    intent: null,
    busy: false,
    error: null,
    start: noop,
    cancel: noop,
    complete: noop,
    setError: noop,
    ...over,
});

export default story<PaymentMethodFormProps>({
    component: "PaymentMethodForm",
    summary: "Saves a card (and on web a bank account) for a client through a Stripe setup intent.",
    controls: { allowBank: { type: "boolean" } },
    examples: [
        {
            key: "start",
            title: "Choose a method",
            props: () => ({ flow: flow({}), allowBank: true }),
        },
        {
            key: "card-only",
            title: "Card only",
            props: () => ({ flow: flow({}), allowBank: false }),
        },
        {
            key: "starting",
            title: "Starting",
            props: () => ({ flow: flow({ busy: true, kind: "card" }), allowBank: true }),
        },
        {
            key: "error",
            title: "Error",
            props: () => ({
                flow: flow({ error: "Couldn't start the card form. Please try again." }),
                allowBank: true,
            }),
        },
        {
            key: "card-form",
            title: "Card form (Stripe not configured in the preview)",
            props: () => ({
                flow: flow({
                    kind: "card",
                    intent: { client_secret: "seti_123_secret_456", stripe_account_id: "acct_123" },
                }),
                allowBank: true,
            }),
        },
        {
            key: "bank-starting",
            title: "Starting a bank account",
            props: () => ({ flow: flow({ busy: true, kind: "bank" }), allowBank: true }),
        },
        {
            key: "long-error",
            title: "Long error, card only",
            props: () => ({
                flow: flow({
                    error: "The connected account can't save cards yet. Finish the payouts setup in Getting paid, then try again. If this keeps happening, contact support with reference seti_123.",
                }),
                allowBank: false,
            }),
        },
    ],
});
