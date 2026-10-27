import { formatLongDate } from "@clientbridge/app-core/public";

import type { LineIconName } from "../art/LineIcon";
import type { PageMeta } from "../routes";
import { planPrices } from "./plans";
import { solutionPath, TRADES } from "./trades";
import { closingCopy, ctaLabel, trialAnswer } from "./waitlist";
import { strings } from "../strings";

const s = strings.pages;

export const contactEmail = "hello@clientbridge.ca";

/** Meta for a page titled after its headline: "Pricing | Clientbridge". */
export const pageMeta = (m: { headline: string; description: string }): PageMeta => ({
    title: strings.site.pageTitle(m.headline),
    headline: m.headline,
    description: m.description,
});

export const pricingMeta = pageMeta(s.pricingMeta);

export const pricingPage = {
    eyebrow: s.pricingPage.eyebrow,
    title: s.pricingPage.title,
    lede: s.pricingPage.lede,
    plans: [
        {
            tier: s.pricingPage.plans.premium,
            prices: planPrices.premium,
            staff: s.pricingPage.plans.premium.staff(planPrices.seat),
        },
        {
            tier: s.pricingPage.plans.team,
            prices: planPrices.team,
            staff: s.pricingPage.plans.team.staff,
        },
    ].map(({ tier, prices, staff }) => ({
        name: tier.name,
        summary: tier.summary,
        price: s.pricingPage.plans.price(prices.month),
        per: s.pricingPage.plans.per,
        yearly: s.pricingPage.plans.yearly(prices.year),
        staff,
    })),
    trial: s.pricingPage.plans.trial,
    cta: ctaLabel(s.pricingPage.plans.cta),
    included: {
        title: s.pricingPage.included.title,
        groups: [
            s.pricingPage.included.groups[0],
            s.pricingPage.included.groups[1],
            s.pricingPage.included.groups[2],
        ],
    },
    fees: {
        title: s.pricingPage.fees.title,
        lede: s.pricingPage.fees.lede,
        rows: [
            s.pricingPage.fees.rows[0],
            s.pricingPage.fees.rows[1],
            s.pricingPage.fees.rows[2],
            s.pricingPage.fees.rows[3],
            s.pricingPage.fees.rows[4],
        ],
    },
    faqTitle: s.pricingPage.faqTitle,
    faq: [
        { ...s.pricingPage.faq[0], a: trialAnswer(s.pricingPage.faq[0].a) },
        s.pricingPage.faq[1],
        s.pricingPage.faq[2],
        s.pricingPage.faq[3],
        s.pricingPage.faq[4],
        s.pricingPage.faq[5],
        s.pricingPage.faq[6],
        s.pricingPage.faq[7],
        s.pricingPage.faq[8],
    ],
    closing: closingCopy(s.pricingPage.closing),
};

export const paymentsMeta = pageMeta(s.paymentsPage.meta);

const band = (i: 0 | 1) => ({
    eyebrow: s.paymentsPage.bands[i].eyebrow,
    title: s.paymentsPage.bands[i].title,
    body: s.paymentsPage.bands[i].body,
    points: s.paymentsPage.bands[i].points,
});

export const paymentsPage = {
    eyebrow: s.paymentsPage.eyebrow,
    title: s.paymentsPage.title,
    lede: s.paymentsPage.lede,
    bands: [band(0), band(1)],
    stripeEyebrow: s.paymentsPage.stripeEyebrow,
    faqTitle: s.paymentsPage.faqTitle,
    // the payment questions from the pricing page, so the two pages answer them the same way
    faq: [s.pricingPage.faq[1], s.pricingPage.faq[2], s.pricingPage.faq[3]],
    closing: closingCopy(s.paymentsPage.closing),
};

export const contactPage = {
    meta: pageMeta(s.contactPage.meta),
    thanksMeta: pageMeta(s.contactPage.thanks.meta),
    eyebrow: s.contactPage.eyebrow,
    title: s.contactPage.title,
    lede: s.contactPage.lede,
    name: s.contactPage.name,
    email: s.contactPage.email,
    message: s.contactPage.message,
    honeypot: s.contactPage.honeypot,
    submit: s.contactPage.submit,
    consent: s.contactPage.consent,
    retry: s.contactPage.retry,
    reach: s.contactPage.reach(contactEmail, strings.pages.legal.address),
    thanks: s.contactPage.thanks,
};

export const featuresMeta = pageMeta(s.featuresMeta);

interface FeatureGroup {
    id: string;
    icon: LineIconName;
    title: string;
    body: string;
    items: readonly string[];
    link: { label: string; href: string };
}

export const featuresPage = {
    eyebrow: s.featuresPage.eyebrow,
    title: s.featuresPage.title,
    lede: s.featuresPage.lede,
    groups: [
        {
            id: "bookings",
            icon: "booking",
            title: s.featuresPage.groups.bookings.title,
            body: s.featuresPage.groups.bookings.body,
            items: s.featuresPage.groups.bookings.items,
            link: { label: s.featuresPage.groups.bookings.link.label, href: "/#features" },
        },
        {
            id: "clients",
            icon: "form",
            title: s.featuresPage.groups.clients.title,
            body: s.featuresPage.groups.clients.body,
            items: s.featuresPage.groups.clients.items,
            link: { label: s.featuresPage.groups.clients.link.label, href: "/solutions" },
        },
        {
            id: "invoices",
            icon: "invoice",
            title: s.featuresPage.groups.invoices.title,
            body: s.featuresPage.groups.invoices.body,
            items: s.featuresPage.groups.invoices.items,
            link: { label: s.featuresPage.groups.invoices.link.label, href: "/#features" },
        },
        {
            id: "payments",
            icon: "tapToPay",
            title: s.featuresPage.groups.payments.title,
            body: s.featuresPage.groups.payments.body,
            items: s.featuresPage.groups.payments.items,
            link: { label: s.featuresPage.groups.payments.link.label, href: "/payments" },
        },
        {
            id: "products",
            icon: "stock",
            title: s.featuresPage.groups.products.title,
            body: s.featuresPage.groups.products.body,
            items: s.featuresPage.groups.products.items,
            link: { label: s.featuresPage.groups.products.link.label, href: "/#products" },
        },
        {
            id: "tax",
            icon: "tax",
            title: s.featuresPage.groups.tax.title,
            body: s.featuresPage.groups.tax.body,
            items: s.featuresPage.groups.tax.items,
            link: { label: s.featuresPage.groups.tax.link.label, href: "/payments#flow" },
        },
        {
            id: "staff",
            icon: "staff",
            title: s.featuresPage.groups.staff.title,
            body: s.featuresPage.groups.staff.body,
            items: s.featuresPage.groups.staff.items,
            link: { label: s.featuresPage.groups.staff.link.label, href: "/pricing" },
        },
        {
            id: "messaging",
            icon: "messaging",
            title: s.featuresPage.groups.messaging.title,
            body: s.featuresPage.groups.messaging.body,
            items: s.featuresPage.groups.messaging.items,
            link: { label: s.featuresPage.groups.messaging.link.label, href: "/solutions" },
        },
        {
            id: "apps",
            icon: "offline",
            title: s.featuresPage.groups.apps.title,
            body: s.featuresPage.groups.apps.body,
            items: s.featuresPage.groups.apps.items,
            link: { label: s.featuresPage.groups.apps.link.label, href: "/pricing" },
        },
    ] satisfies FeatureGroup[],
    tradesTitle: s.featuresPage.tradesTitle,
    trades: TRADES.map((t) => ({ label: t.name, href: solutionPath(t.slug), glyph: t.glyph })),
};

interface LegalSection {
    title: string;
    body: readonly string[];
    items: readonly string[];
}

export interface LegalPage {
    meta: PageMeta;
    title: string;
    updated: string;
    intro: string;
    sections: LegalSection[];
    contactTitle: string;
    contact: string;
    paymentDisclosure: {
        title: string;
        body: string;
        links: { label: string; href: string }[];
    };
}

const PRIVACY_UPDATED = new Date("2026-10-27T12:00:00-04:00");
const TERMS_UPDATED = new Date("2026-10-14T12:00:00-04:00");

const legalSections = (
    sections: readonly { title: string; body: readonly string[]; items?: readonly string[] }[],
): LegalSection[] => sections.map((x) => ({ title: x.title, body: x.body, items: x.items ?? [] }));

export const paymentDisclosure = {
    title: s.paymentDisclosure.title,
    body: s.paymentDisclosure.body,
    links: [
        {
            label: s.paymentDisclosure.links[0].label,
            href: "https://stripe.com/connect-account/legal/full",
        },
        { label: s.paymentDisclosure.links[1].label, href: "https://stripe.com/privacy" },
        {
            label: s.paymentDisclosure.links[2].label,
            href: "https://stripe.com/legal/acquirer-disclosure",
        },
    ],
};

export const privacyPage: LegalPage = {
    paymentDisclosure,
    meta: pageMeta(s.privacyPage.meta),
    title: s.privacyPage.title,
    updated: s.legal.updated(formatLongDate(PRIVACY_UPDATED, "America/Toronto")),
    intro: s.privacyPage.intro,
    sections: legalSections(s.privacyPage.sections),
    contactTitle: s.legal.contactTitle,
    contact: s.privacyPage.contact(contactEmail, s.legal.address),
};

export const termsPage: LegalPage = {
    paymentDisclosure,
    meta: pageMeta(s.termsPage.meta),
    title: s.termsPage.title,
    updated: s.legal.updated(formatLongDate(TERMS_UPDATED, "America/Toronto")),
    intro: s.termsPage.intro,
    sections: legalSections(s.termsPage.sections),
    contactTitle: s.legal.contactTitle,
    contact: s.termsPage.contact(contactEmail, s.legal.address),
};
