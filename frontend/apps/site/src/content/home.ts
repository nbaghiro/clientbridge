import type { LineIconName } from "../art/LineIcon";
import type { GlyphName } from "../art/TradeGlyph";
import { planPrices } from "./plans";
import { strings } from "../strings";

const s = strings.home;

export const homeMeta = s.homeMeta;

export const hero = s.hero;

export const props: { icon: LineIconName; title: string; body: string }[] = [
    {
        icon: "booking",
        title: s.props[0].title,
        body: s.props[0].body,
    },
    {
        icon: "payout",
        title: s.props[1].title,
        body: s.props[1].body,
    },
    {
        icon: "tax",
        title: s.props[2].title,
        body: s.props[2].body,
    },
];

export const solutionsIntro = s.solutionsIntro;

export type FeatureMock = "calendar" | "invoices" | "tapToPay" | "products" | "bookingPage";

export interface Feature {
    id?: string;
    glyph: GlyphName;
    eyebrow: string;
    title: string;
    body: string;
    points: readonly string[];
    mock: FeatureMock;
}

export const features: Feature[] = [
    {
        glyph: "paw",
        eyebrow: s.features[0].eyebrow,
        title: s.features[0].title,
        body: s.features[0].body,
        points: s.features[0].points,
        mock: "calendar",
    },
    {
        glyph: "book",
        eyebrow: s.features[1].eyebrow,
        title: s.features[1].title,
        body: s.features[1].body,
        points: s.features[1].points,
        mock: "invoices",
    },
    {
        glyph: "scissors",
        eyebrow: s.features[2].eyebrow,
        title: s.features[2].title,
        body: s.features[2].body,
        points: s.features[2].points,
        mock: "tapToPay",
    },
    {
        id: "products",
        glyph: "spray",
        eyebrow: s.features[3].eyebrow,
        title: s.features[3].title,
        body: s.features[3].body,
        points: s.features[3].points,
        mock: "products",
    },
    {
        glyph: "camera",
        eyebrow: s.features[4].eyebrow,
        title: s.features[4].title,
        body: s.features[4].body,
        points: [],
        mock: "bookingPage",
    },
];

export const payments = {
    eyebrow: s.payments.eyebrow,
    title: s.payments.title,
    lede: s.payments.lede,
    steps: [s.payments.steps[0], s.payments.steps[1], s.payments.steps[2], s.payments.steps[3]],
};

export const included = {
    eyebrow: s.included.eyebrow,
    title: s.included.title,
    items: [
        {
            icon: "gift",
            title: s.included.items[0].title,
            body: s.included.items[0].body,
        },
        {
            icon: "package",
            title: s.included.items[1].title,
            body: s.included.items[1].body,
        },
        {
            icon: "subscription",
            title: s.included.items[2].title,
            body: s.included.items[2].body,
        },
        {
            icon: "shop",
            title: s.included.items[3].title,
            body: s.included.items[3].body,
        },
        {
            icon: "stock",
            title: s.included.items[4].title,
            body: s.included.items[4].body,
        },
        {
            icon: "addon",
            title: s.included.items[5].title,
            body: s.included.items[5].body,
        },
        {
            icon: "staff",
            title: s.included.items[6].title,
            body: s.included.items[6].body,
        },
        {
            icon: "commission",
            title: s.included.items[7].title,
            body: s.included.items[7].body,
        },
        {
            icon: "messaging",
            title: s.included.items[8].title,
            body: s.included.items[8].body,
        },
        {
            icon: "reviews",
            title: s.included.items[9].title,
            body: s.included.items[9].body,
        },
        {
            icon: "offline",
            title: s.included.items[10].title,
            body: s.included.items[10].body,
        },
        {
            icon: "reports",
            title: s.included.items[11].title,
            body: s.included.items[11].body,
        },
    ] satisfies { icon: LineIconName; title: string; body: string }[],
};

export const proof = {
    eyebrow: s.proof.eyebrow,
    logo: s.proof.logo,
    logoCount: 5,
    testimonials: [1, 2, 3].map(testimonialPlaceholder),
};

export interface TestimonialCopy {
    lead: string;
    body: string;
    byline: string;
}

export function testimonialPlaceholder(n: number): TestimonialCopy {
    return {
        lead: s.testimonial.lead(n),
        body: s.testimonial.body,
        byline: s.testimonial.byline,
    };
}

export const pricing = {
    ...s.pricing,
    price: s.pricing.price(planPrices.premium.month),
    note: s.pricing.note(planPrices.team.month),
    points: [
        s.pricing.points[0],
        s.pricing.points[1],
        s.pricing.points[2],
        s.pricing.points[3](planPrices.seat),
    ],
};

export const closing = s.closing;
