import type { DocTotalsProps } from "@clientbridge/app-core";

import { story } from "../story";

export default story<DocTotalsProps>({
    component: "DocTotals",
    summary: "A document's money summary: subtotal, tax, credits, deductions, total and balance.",
    controls: { density: { type: "select", options: ["regular", "compact"] } },
    examples: [
        {
            key: "invoice",
            title: "Invoice with a deposit",
            props: () => ({
                lines: [
                    { key: "sub", label: "Subtotal", cents: 9000, kind: "subtotal" },
                    { key: "gst", label: "GST", hint: "5%", cents: 450, kind: "tax" },
                    { key: "pst", label: "PST", hint: "7%", cents: 70, kind: "tax" },
                    { key: "total", label: "Total", cents: 9520, kind: "total" },
                    { key: "deposit", label: "Deposit paid", cents: 2000, kind: "credit" },
                    { key: "balance", label: "Balance due", cents: 7520, kind: "balance" },
                ],
            }),
        },
        {
            key: "payout",
            title: "Payout with a fee (compact)",
            props: () => ({
                density: "compact",
                lines: [
                    { key: "gross", label: "Card sales", cents: 125000, kind: "subtotal" },
                    { key: "fee", label: "Processing fees", cents: 3655, kind: "deduction" },
                    { key: "refund", label: "Refunds", cents: 2800, kind: "deduction" },
                    { key: "net", label: "Paid out", cents: 118545, kind: "total" },
                ],
            }),
        },
    ],
});
