import type { BrandMarkProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<BrandMarkProps>({
    component: "BrandMark",
    summary: "The small mark beside a saved card, bank account or Interac payment.",
    controls: { size: { type: "select", options: ["sm", "md"] } },
    examples: [
        { key: "visa", title: "Visa", props: () => ({ method: "card", brand: "visa" }) },
        {
            key: "mastercard",
            title: "Mastercard",
            props: () => ({ method: "card", brand: "mastercard" }),
        },
        {
            key: "amex",
            title: "Amex, small",
            props: () => ({ method: "card", brand: "amex", size: "sm" }),
        },
        { key: "unknown", title: "Unknown card", props: () => ({ method: "card", brand: null }) },
        { key: "bank", title: "Bank account", props: () => ({ method: "bank_eft", brand: null }) },
        { key: "interac", title: "Interac", props: () => ({ method: "interac", brand: null }) },
    ],
});
