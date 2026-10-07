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
        {
            key: "discover",
            title: "Discover",
            props: () => ({ method: "card", brand: "discover" }),
        },
        { key: "unknown", title: "Unknown card", props: () => ({ method: "card", brand: null }) },
        {
            key: "unknown-brand",
            title: "Brand we have no mark for",
            props: () => ({ method: "card", brand: "unionpay" }),
        },
        { key: "bank", title: "Bank account", props: () => ({ method: "bank_eft", brand: null }) },
        { key: "interac", title: "Interac", props: () => ({ method: "interac", brand: null }) },
        {
            key: "interac-small",
            title: "Interac, small",
            props: () => ({ method: "interac", brand: null, size: "sm" }),
        },
        {
            key: "bank-small",
            title: "Bank account, small",
            props: () => ({ method: "bank_eft", brand: null, size: "sm" }),
        },
    ],
});
