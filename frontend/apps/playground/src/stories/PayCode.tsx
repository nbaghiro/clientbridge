import type { PayCodeProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<PayCodeProps>({
    component: "PayCode",
    summary: "A scannable code for a pay or accept link, drawn from the URL.",
    controls: {
        value: { type: "text" },
        size: { type: "number", min: 48, max: 200, step: 8 },
        label: { type: "text" },
    },
    examples: [
        {
            key: "default",
            title: "Pay link",
            props: () => ({
                value: "https://book.clientbridge.app/pay/inv_1148",
                label: "Scan to pay invoice 1148",
            }),
        },
        {
            key: "small",
            title: "Small, on a printed page",
            props: () => ({
                value: "https://book.clientbridge.app/pay/inv_1149",
                size: 64,
                label: "Scan to pay",
            }),
        },
        {
            key: "large",
            title: "Large, on a counter screen",
            props: () => ({
                value: "https://book.clientbridge.app/pay/inv_1150",
                size: 160,
                label: "Scan to pay",
            }),
        },
        {
            key: "long-url",
            title: "A long URL (denser code)",
            props: () => ({
                value: "https://book.clientbridge.app/accept/est_2087?token=9f8e7d6c5b4a39281706f5e4d3c2b1a0e9f8d7c6b5a4",
                size: 120,
                label: "Scan to accept estimate 2087",
            }),
        },
    ],
});
