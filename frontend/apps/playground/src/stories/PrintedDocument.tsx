import type { PrintedDoc, PrintedDocumentProps } from "@clientbridge/app-core";

import { story } from "../story";

const business: PrintedDoc["business"] = {
    name: "Birchbark Pet Studio",
    initials: "BB",
    tagline: "Calm, careful grooming on Vancouver Island.",
    brandColor: "#2F5D4A",
    address: ["1820 Cook St", "Victoria, BC V8T 3P5"],
    phone: "(250) 555-0100",
    email: "hello@birchbarkpets.ca",
    website: "birchbarkpets.ca",
    registration: "GST/HST 81234 5678 RT0001 · PST-1234-5678",
};

const labels: PrintedDoc["labels"] = {
    from: "From",
    item: "Item",
    qty: "Qty",
    price: "Price",
    tax: "Tax",
    amount: "Amount",
    taxSummary: "Tax summary",
    taxBase: "on",
    howToPay: "How to pay",
    scanToPay: "Scan to pay",
    paymentMethod: "Payment",
    page: "Page 1 of 1",
    forPet: (pet) => `For ${pet}`,
};

const invoice: PrintedDoc = {
    kind: "invoice",
    title: "Invoice",
    number: "1148",
    business,
    partyLabel: "Bill to",
    partyName: "Amélie Tremblay",
    partyLines: ["amelie.t@example.com", "(250) 555-0201"],
    meta: [
        { label: "Invoice number", value: "#1148" },
        { label: "Issued", value: "October 6, 2026" },
        { label: "Due", value: "October 20, 2026" },
    ],
    lines: [
        {
            id: "l1",
            description: "Full groom, large dog",
            subject: "Biscuit",
            quantity: 1,
            unitCents: 9_500,
            amountCents: 9_500,
            taxCodes: ["GST"],
        },
        {
            id: "l2",
            description: "Nail trim",
            subject: "Biscuit",
            quantity: 1,
            unitCents: 1_800,
            amountCents: 1_800,
            taxCodes: ["GST"],
        },
        {
            id: "l3",
            description: "Oatmeal Soothe Shampoo (500ml)",
            subject: null,
            quantity: 2,
            unitCents: 2_400,
            amountCents: 4_800,
            taxCodes: ["GST", "PST"],
        },
    ],
    taxes: [
        { code: "GST", label: "GST 5%", baseCents: 16_100, cents: 805 },
        { code: "PST", label: "PST 7%", baseCents: 4_800, cents: 336 },
    ],
    totals: [
        { key: "sub", label: "Subtotal", cents: 16_100, kind: "subtotal" },
        { key: "tax", label: "Tax", cents: 1_141, kind: "tax" },
        { key: "total", label: "Total", cents: 17_241, kind: "total" },
        { key: "dep", label: "Deposit paid", cents: 2_500, kind: "credit" },
        { key: "bal", label: "Balance due", cents: 14_741, kind: "balance" },
    ],
    headline: { label: "Balance due", cents: 14_741 },
    payment: null,
    stamp: null,
    payUrl: "https://book.clientbridge.app/pay/inv_1148",
    instructions: [
        "Pay online with the link or code.",
        "Or send an Interac e-Transfer to pay@birchbarkpets.ca with 1148 as the message.",
    ],
    message: "Thanks for trusting us with Biscuit. See you in six weeks.",
    footer: "Questions about this invoice? Reply to the email it came with.",
    labels,
};

const receipt: PrintedDoc = {
    ...invoice,
    kind: "receipt",
    title: "Receipt",
    number: "1148-1",
    meta: [
        { label: "Receipt for", value: "#1148" },
        { label: "Paid", value: "October 8, 2026" },
        { label: "Method", value: "Visa ending 4242" },
    ],
    totals: [
        { key: "total", label: "Total", cents: 17_241, kind: "total" },
        { key: "paid", label: "Paid", cents: 17_241, kind: "credit" },
        { key: "bal", label: "Balance", cents: 0, kind: "balance" },
    ],
    headline: { label: "Amount paid", cents: 17_241 },
    payment: {
        method: "Visa ending 4242",
        reference: "ch_3PQ8",
        at: "October 8, 2026, 10:14 a.m.",
        amountCents: 17_241,
    },
    stamp: "Paid",
    payUrl: null,
    instructions: [],
    message: null,
};

const estimate: PrintedDoc = {
    ...invoice,
    kind: "estimate",
    title: "Estimate",
    number: "E-0042",
    partyLabel: "Prepared for",
    meta: [
        { label: "Estimate number", value: "#E-0042" },
        { label: "Issued", value: "October 6, 2026" },
        { label: "Valid until", value: "November 5, 2026" },
    ],
    totals: [
        { key: "sub", label: "Subtotal", cents: 16_100, kind: "subtotal" },
        { key: "tax", label: "Tax", cents: 1_141, kind: "tax" },
        { key: "total", label: "Estimate total", cents: 17_241, kind: "total" },
    ],
    headline: { label: "Estimate total", cents: 17_241 },
    payUrl: "https://book.clientbridge.app/accept/est_0042",
    instructions: ["Accept online with the link or code."],
    message: null,
};

const voided: PrintedDoc = {
    ...invoice,
    number: "1150",
    stamp: "Void",
    payUrl: null,
    instructions: [],
};

const long: PrintedDoc = {
    ...invoice,
    number: "2026-000118-BB",
    business: {
        ...business,
        name: "Birchbark Pet Studio and Mobile Grooming Collective of Southern Vancouver Island",
        initials: "BP",
    },
    partyName: "ليلى عبد الرحمن الهاشمي",
    partyLines: ["layla.alhashemi.family.account@example-really-long-domain.com"],
    lines: [
        {
            id: "l1",
            description:
                "Full groom for a very large double-coated breed including de-shedding treatment, blowout and hand scissoring",
            subject: "Sir Reginald Fluffington the Third",
            quantity: 1,
            unitCents: 18_500,
            amountCents: 18_500,
            taxCodes: ["GST", "PST"],
        },
        {
            id: "l2",
            description: "قص الأظافر",
            subject: "ليلى",
            quantity: 12,
            unitCents: 1_800,
            amountCents: 21_600,
            taxCodes: ["GST"],
        },
    ],
    message:
        "Thank you for trusting us with Sir Reginald. He was a perfect gentleman, apart from the brief standoff with the dryer, which we resolved with patience and a peanut butter lick mat.",
};

export default story<PrintedDocumentProps>({
    component: "PrintedDocument",
    summary:
        "An invoice, estimate or receipt drawn as the page the client gets; the PDF uses the same model.",
    controls: { template: { type: "select", options: ["classic", "statement"] } },
    examples: [
        { key: "invoice", title: "Invoice, classic", props: () => ({ doc: invoice }) },
        {
            key: "statement",
            title: "Invoice, statement",
            props: () => ({ doc: invoice, template: "statement" }),
        },
        { key: "receipt", title: "Receipt, classic", props: () => ({ doc: receipt }) },
        {
            key: "receipt-statement",
            title: "Receipt, statement",
            props: () => ({ doc: receipt, template: "statement" }),
        },
        { key: "estimate", title: "Estimate, classic", props: () => ({ doc: estimate }) },
        {
            key: "estimate-statement",
            title: "Estimate, statement",
            props: () => ({ doc: estimate, template: "statement" }),
        },
        { key: "void", title: "Void invoice, no way to pay", props: () => ({ doc: voided }) },
        {
            key: "long",
            title: "Long names, Arabic client and lines",
            props: () => ({ doc: long }),
        },
    ],
});
