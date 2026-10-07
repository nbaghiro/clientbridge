import type { ChargeSheetProps, Checkout } from "@clientbridge/app-core";

import { noop, story } from "../story";

const checkout = (over: Partial<Checkout> = {}): Checkout => ({
    method: "",
    setMethod: noop,
    allowNewCard: true,
    busy: false,
    error: null,
    setError: noop,
    clientSecret: null,
    pay: noop,
    complete: noop,
    cancel: noop,
    ...over,
});

const methods = [
    { id: "pm_visa", label: "Visa ending 4242" },
    { id: "pm_mc", label: "Mastercard ending 4444" },
];

export default story<ChargeSheetProps>({
    component: "ChargeSheet",
    summary: "The checkout: what is being bought, a saved or new card, and the charge button.",
    controls: {
        title: { type: "text" },
        submitLabel: { type: "text" },
        amountLabel: { type: "text" },
    },
    examples: [
        {
            key: "saved",
            title: "Saved card chosen",
            props: (k) => ({
                checkout: checkout({ method: "pm_visa" }),
                methods,
                amountLabel: "$95.20",
                submitLabel: "Charge $95.20",
                busyLabel: "Charging…",
                onSubmit: noop,
                onCancel: noop,
                title: "Gift card",
                children: <k.Text tone="muted">$100 gift card for Diego Ruiz</k.Text>,
            }),
        },
        {
            key: "busy",
            title: "Busy",
            props: () => ({
                checkout: checkout({ busy: true }),
                methods,
                amountLabel: "$50.40",
                submitLabel: "Charge $50.40",
                busyLabel: "Charging…",
                onSubmit: noop,
                onCancel: noop,
            }),
        },
        {
            key: "error",
            title: "Card declined",
            props: () => ({
                checkout: checkout({ error: "The card was declined. Try another card." }),
                methods,
                amountLabel: "$50.40",
                submitLabel: "Charge $50.40",
                busyLabel: "Charging…",
                onSubmit: noop,
                onCancel: noop,
            }),
        },
        {
            key: "no-methods",
            title: "Saved cards only, none on file",
            props: () => ({
                checkout: checkout({ allowNewCard: false }),
                methods: [],
                amountLabel: "$29.12",
                submitLabel: "Charge $29.12",
                busyLabel: "Charging…",
                onSubmit: noop,
                onCancel: noop,
            }),
        },
        {
            key: "saved-only",
            title: "Saved cards only, none chosen yet",
            props: () => ({
                checkout: checkout({ allowNewCard: false }),
                methods,
                amountLabel: "$29.12",
                submitLabel: "Charge $29.12",
                busyLabel: "Charging…",
                onSubmit: noop,
                onCancel: noop,
            }),
        },
        {
            key: "long",
            title: "Long method names and a right-to-left title",
            props: (k) => ({
                checkout: checkout({ method: "pm_long" }),
                methods: [
                    {
                        id: "pm_long",
                        label: "Visa ending 4242 · Bartholomew Featherstonehaugh-Montgomery · expires 12/30",
                    },
                    { id: "pm_rtl", label: "ليلى حداد · Mastercard ending 4444" },
                ],
                amountLabel: "$1,240.00",
                submitLabel: "Charge $1,240.00",
                busyLabel: "Charging…",
                onSubmit: noop,
                onCancel: noop,
                title: "נועה כהן · כרטיס מתנה",
                children: <k.Text tone="muted">Package of 10 full grooms</k.Text>,
            }),
        },
        {
            key: "confirm-card",
            title: "New card to confirm",
            props: () => ({
                checkout: checkout({ clientSecret: "pi_demo_secret" }),
                methods,
                stripeAccount: "acct_demo",
                amountLabel: "$84.00",
                submitLabel: "Charge $84.00",
                busyLabel: "Charging…",
                onSubmit: noop,
                onCancel: noop,
            }),
        },
    ],
});
