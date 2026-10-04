import type { LineIconName } from "../art/LineIcon";
import { solutionPath, TRADES } from "./trades";

export const contactEmail = "hello@clientbridge.ca";

export const pricingMeta = {
    title: "Pricing | Clientbridge",
    description:
        "One monthly plan with booking, invoices, payments, sales tax, staff pay and the iPhone and Android apps included. Card payments carry Stripe's processing fee; Interac e-Transfers do not.",
};

export const pricingPage = {
    eyebrow: "Pricing",
    title: "One plan, with every feature included.",
    lede: "Every business gets the full product: the booking page, invoices, payments, sales tax, staff pay and the apps. You pay one monthly price, plus a small amount for each extra staff member.",
    plan: {
        name: "Clientbridge",
        price: "$[price]",
        per: " / month",
        note: "Placeholder. Final pricing to be confirmed.",
        seat: "Each additional staff member: $[price] / month (placeholder).",
        cta: "Start free",
        groups: [
            {
                title: "Front desk",
                items: [
                    "Online booking page with deposits",
                    "Calendar with day, week, month and staff views",
                    "Recurring bookings, classes and capacity",
                    "Reminders by email and text",
                ],
            },
            {
                title: "Getting paid",
                items: [
                    "Card, Tap to Pay and Interac e-Transfer",
                    "Invoices, estimates and pay links",
                    "Gift cards, packages and memberships",
                    "Refunds and partial refunds",
                ],
            },
            {
                title: "Back office",
                items: [
                    "GST, HST, PST and QST on every line",
                    "Return reports and remittance tracking",
                    "Staff roles, hours and pay records",
                    "Income and T4A reports for your bookkeeper",
                ],
            },
        ],
    },
    fees: {
        title: "Payment fees",
        lede: "Fees on payments are separate from the plan price and are shown on every payout.",
        rows: [
            {
                label: "Card online and Tap to Pay",
                value: "Stripe's standard processing fee, taken from each payment. Clientbridge platform fee: to be confirmed.",
            },
            {
                label: "Interac e-Transfer",
                value: "No card fee. The transfer goes from your client's bank to yours and is matched to the invoice by its reference code.",
            },
            {
                label: "Setup",
                value: "No setup fee. Connecting your Stripe account takes a few minutes inside the app.",
            },
        ],
    },
    faqTitle: "Common questions",
    faq: [
        {
            q: "Can I try it before I pay?",
            a: "Yes. You can start without a card and look around a demo business that already has a full week of bookings, invoices and payments.",
        },
        {
            q: "How do I get paid?",
            a: "Clientbridge uses Stripe Connect, so your business has its own Stripe account. Card payments land in that account and Stripe pays them out to your bank on a regular schedule. Clientbridge never holds your money.",
        },
        {
            q: "What does an Interac e-Transfer cost?",
            a: "There is no card fee. Your client sends the transfer from their bank using the reference code on the invoice, and the payment is matched to the invoice when it arrives.",
        },
        {
            q: "Is sales tax included?",
            a: "Yes. GST, HST, PST and QST are worked out for your province on every invoice line, and the tax you collected is tracked by period with a report ready for your return.",
        },
        {
            q: "Do my staff need their own login?",
            a: "Each staff member gets their own login with the right role. Staff see their own schedule and clients, and owners and admins see the money.",
        },
        {
            q: "Does it work on my phone?",
            a: "Yes. There is a web app and apps for iPhone and Android. The schedule and client list stay on your device, so they are there even when the connection drops.",
        },
        {
            q: "Can clients book from my own website?",
            a: "Yes. Your booking page has its own link, and it can be embedded on your existing website with a short snippet.",
        },
    ],
    closing: {
        title: "See it with a business that is already set up.",
        lede: "The demo opens Birchbark Pet Studio, a grooming business in Victoria, with bookings, invoices and payments to look through.",
        primary: "Start free",
        secondary: "Open the demo",
    },
};

export const featuresMeta = {
    title: "Features | Clientbridge",
    description:
        "Everything Clientbridge does: online booking and the calendar, client records, invoices and estimates, card, Tap to Pay and Interac payments, sales tax, staff pay, messaging, reviews and the apps.",
};

export interface FeatureGroup {
    id: string;
    icon: LineIconName;
    title: string;
    body: string;
    items: string[];
    link: { label: string; href: string };
}

export const featuresPage = {
    eyebrow: "Features",
    title: "Everything the business runs on, in one app.",
    lede: "Clientbridge covers the front desk and the back office for a service business. These are the parts, and each one works with the others.",
    groups: [
        {
            id: "bookings",
            icon: "booking",
            title: "Bookings and the calendar",
            body: "Clients book from your page, and every booking fills the right amount of time on the right person's calendar.",
            items: [
                "Services with their own length, price and buffer",
                "Day, week, month and per-staff views",
                "Recurring bookings, classes and capacity",
                "Deposits taken at booking and applied to the invoice",
                "Reminders by email and text",
            ],
            link: { label: "See the calendar", href: "/#features" },
        },
        {
            id: "clients",
            icon: "form",
            title: "Clients",
            body: "Each client record holds the people, pets or properties you serve, their history and their saved payment methods.",
            items: [
                "Notes, history and lifetime value",
                "Intake forms, waivers and contracts signed online",
                "Saved cards and pre-authorized debit",
                "Packages and memberships on the record",
            ],
            link: { label: "See it by trade", href: "/solutions" },
        },
        {
            id: "invoices",
            icon: "invoice",
            title: "Invoices and estimates",
            body: "Invoices pick up the services from the visit, add the right tax and go out with a link the client can pay from.",
            items: [
                "Estimates that turn into invoices",
                "Partial payments, refunds and credit notes",
                "Numbered in order for you",
                "Overdue invoices easy to spot",
            ],
            link: { label: "See invoices", href: "/#features" },
        },
        {
            id: "payments",
            icon: "tapToPay",
            title: "Payments",
            body: "Card online, Tap to Pay in person and Interac e-Transfer all land in one place, matched to the invoice they pay.",
            items: [
                "Tap to Pay on iPhone and Android",
                "Interac e-Transfer matched by reference code",
                "Stripe payouts to your bank",
                "Gift cards, packages and subscriptions",
            ],
            link: { label: "How payments work", href: "/#payments" },
        },
        {
            id: "tax",
            icon: "tax",
            title: "Sales tax",
            body: "GST, HST, PST and QST are worked out for your province on every line, and the amount you owe is always on the Today screen.",
            items: [
                "Tax by province on every invoice line",
                "Tax collected tracked by period",
                "Return report ready to export",
                "Remittances marked as filed",
            ],
            link: { label: "How tax works", href: "/#payments" },
        },
        {
            id: "staff",
            icon: "staff",
            title: "Staff and pay",
            body: "Owners, admins and staff each see what their role needs, and completed work is recorded as earnings.",
            items: [
                "Invites and roles",
                "Working hours per person",
                "Earnings approved and marked paid",
                "T4A report at year end",
            ],
            link: { label: "See pricing for teams", href: "/pricing" },
        },
        {
            id: "messaging",
            icon: "messaging",
            title: "Messaging and reviews",
            body: "Text and email with clients from one inbox, and ask for a review after each visit.",
            items: [
                "Two-way text and email",
                "Broadcasts to a group of clients",
                "Review requests after each visit",
                "Choose which reviews appear on your page",
            ],
            link: { label: "See it by trade", href: "/solutions" },
        },
        {
            id: "apps",
            icon: "offline",
            title: "Web, iPhone and Android",
            body: "The same account on every device. The schedule and client list stay on the device and sync when the connection returns.",
            items: [
                "Web app for the front desk",
                "iPhone and Android apps",
                "Works when the Wi-Fi does not",
                "Reports exported as CSV",
            ],
            link: { label: "See pricing", href: "/pricing" },
        },
    ] satisfies FeatureGroup[],
    tradesTitle: "By trade",
    trades: TRADES.map((t) => ({ label: t.name, href: solutionPath(t.slug), glyph: t.glyph })),
};

export interface LegalPage {
    meta: { title: string; description: string };
    title: string;
    updated: string;
    intro: string;
    sections: string[];
    placeholder: string;
    contact: string;
}

const legalPlaceholder = "Legal text to be provided.";

export const privacyPage: LegalPage = {
    meta: {
        title: "Privacy | Clientbridge",
        description: "How Clientbridge collects, uses and protects personal information.",
    },
    title: "Privacy policy",
    updated: "Last updated: [date to be confirmed]",
    intro: "This page will describe how Clientbridge handles personal information for the businesses that use it and for their clients.",
    sections: [
        "Information we collect",
        "How we use information",
        "Payments and Stripe",
        "Where information is stored",
        "How long we keep information",
        "Your choices and rights",
    ],
    placeholder: legalPlaceholder,
    contact: `Questions about privacy: ${contactEmail} (placeholder address).`,
};

export const termsPage: LegalPage = {
    meta: {
        title: "Terms | Clientbridge",
        description: "The terms that apply to using Clientbridge.",
    },
    title: "Terms of service",
    updated: "Last updated: [date to be confirmed]",
    intro: "This page will set out the terms that apply to businesses using Clientbridge and to their clients using its booking and payment pages.",
    sections: [
        "Using Clientbridge",
        "Your account",
        "Payments and fees",
        "Your content and your clients' information",
        "Availability and changes",
        "Ending your account",
        "Liability",
    ],
    placeholder: legalPlaceholder,
    contact: `Questions about these terms: ${contactEmail} (placeholder address).`,
};
