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
        {
            key: "estimate",
            title: "Estimate, no balance",
            props: () => ({
                lines: [
                    { key: "sub", label: "Subtotal", cents: 24000, kind: "subtotal" },
                    { key: "gst", label: "GST", hint: "5%", cents: 1200, kind: "tax" },
                    { key: "total", label: "Estimate total", cents: 25200, kind: "total" },
                ],
            }),
        },
        {
            key: "paid",
            title: "Paid in full with a gift card",
            props: () => ({
                lines: [
                    { key: "total", label: "Total", cents: 9520, kind: "total" },
                    {
                        key: "gift",
                        label: "Gift card ending 2KXP",
                        cents: 5000,
                        kind: "credit",
                        hint: "Balance left $0.00",
                    },
                    { key: "card", label: "Visa ending 4242", cents: 4520, kind: "credit" },
                    { key: "balance", label: "Balance due", cents: 0, kind: "balance" },
                ],
            }),
        },
        {
            key: "long",
            title: "Long labels and large amounts",
            props: () => ({
                lines: [
                    {
                        key: "sub",
                        label: "Subtotal for twelve weekly grooming visits in the autumn package",
                        cents: 123456789,
                        kind: "subtotal",
                    },
                    {
                        key: "hst",
                        label: "Harmonized sales tax",
                        hint: "13% on taxable services and retail products",
                        cents: 16049382,
                        kind: "tax",
                    },
                    { key: "total", label: "Total", cents: 139506171, kind: "total" },
                ],
            }),
        },
        {
            key: "rtl",
            title: "Right-to-left labels",
            props: () => ({
                density: "compact",
                lines: [
                    { key: "sub", label: "المجموع الفرعي", cents: 9000, kind: "subtotal" },
                    { key: "tax", label: "الضريبة", hint: "٥٪", cents: 450, kind: "tax" },
                    { key: "total", label: "الإجمالي", cents: 9450, kind: "total" },
                ],
            }),
        },
    ],
});
