import type { PayCodeProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<PayCodeProps>({
    component: "PayCode",
    summary: "A scannable code for a pay or accept link, drawn from the URL.",
    controls: { value: { type: "text" }, size: { type: "number", min: 48, max: 200, step: 8 } },
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
    ],
});
