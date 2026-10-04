import type { LineIconName } from "../art/LineIcon";
import type { GlyphName } from "../art/TradeGlyph";

export const homeMeta = {
    title: "Clientbridge: bookings, invoices and payments for service businesses in Canada",
    description:
        "Clientbridge runs the front desk and the back office for groomers, stylists, trainers, cleaners, tutors and trades: online booking, invoices, products and stock, card and Interac payments, and GST/HST worked out for you.",
};

export const hero = {
    eyebrow: "For service businesses in Canada",
    title: "Bookings, invoices and payments, kept in one place.",
    lede: "Clientbridge runs the front desk and the back office for groomers, stylists, trainers, cleaners, tutors and trades. Clients book, buy and pay online, payments are matched to invoices, and GST/HST is worked out for you.",
    primary: "Start free",
    secondary: "See the demo business",
    note: "Web, iPhone and Android. No card required to try it.",
};

export const props: { icon: LineIconName; title: string; body: string }[] = [
    {
        icon: "booking",
        title: "Clients book and pay online",
        body: "Your booking page shows your services and open times, takes a deposit if you want one, and can sit on your own website.",
    },
    {
        icon: "payout",
        title: "Paid out to your bank by Stripe",
        body: "Card, Tap to Pay and Interac e-Transfer all land in one place. Stripe pays your balance out to your bank on a regular schedule.",
    },
    {
        icon: "tax",
        title: "Sales tax worked out for you",
        body: "GST, HST, PST and QST are calculated for your province on every line, and the amount you owe the CRA is always on the Today screen.",
    },
];

export const solutionsIntro = {
    eyebrow: "Solutions",
    title: "Set up for the way your trade works.",
    lede: "The same app runs a grooming salon, a cleaning business and a tutoring studio. Each one starts from services, booking rules and forms that suit the trade.",
};

export type FeatureMock = "calendar" | "invoices" | "tapToPay" | "products" | "bookingPage";

export interface Feature {
    id?: string;
    glyph: GlyphName;
    eyebrow: string;
    title: string;
    body: string;
    points: string[];
    mock: FeatureMock;
}

export const features: Feature[] = [
    {
        glyph: "paw",
        eyebrow: "Schedule",
        title: "A calendar that knows your services and your staff.",
        body: "Each service carries its own length, price and buffer, so a booking fills the right amount of time. Recurring visits repeat on their own, and reminders go out by email and text before each one.",
        points: [
            "Day, week, month and per-staff views",
            "Recurring bookings for regular clients",
            "Deposits taken at booking and applied to the invoice",
        ],
        mock: "calendar",
    },
    {
        glyph: "book",
        eyebrow: "Invoices and estimates",
        title: "Send an invoice from the booking, and see when it is paid.",
        body: "Invoices pick up the services from the visit, add the right tax, and go out with a link the client can pay from. Estimates turn into invoices when the client accepts them, and overdue invoices are easy to spot.",
        points: [
            "Card or Interac e-Transfer on every invoice",
            "Partial payments, refunds and credit notes",
            "Numbered in order for you",
        ],
        mock: "invoices",
    },
    {
        glyph: "scissors",
        eyebrow: "Point of sale",
        title: "Take a card at the counter with the phone you already have.",
        body: "Tap to Pay turns an iPhone or Android phone into a card reader, so you can charge for a visit or sell a retail item without extra hardware. The sale is recorded against the client and the tax is included.",
        points: [
            "Tap to Pay on iPhone and Android",
            "Retail items, gift cards and packages at checkout",
            "Schedule and client list available offline",
        ],
        mock: "tapToPay",
    },
    {
        id: "products",
        glyph: "spray",
        eyebrow: "Products and stock",
        title: "Sell products too, at the desk and online.",
        body: "Shampoo, brushes, supplements or styling products sit in the same catalog as your services, with a SKU, a cost and a stock count if you want one. Ring them up on the same ticket as a visit, or let clients order from your shop page and pick up.",
        points: [
            "Stock counts drop as you sell, with a low-stock list and restock",
            "Clients add a product when they book, and it goes on the visit's invoice",
            "Itemised receipts by email or text, and sales by item for your bookkeeper",
        ],
        mock: "products",
    },
    {
        glyph: "camera",
        eyebrow: "Your public pages",
        title: "Booking and payment pages with your name on them.",
        body: "Clients see your logo and colour, not ours. Booking, paying an invoice, signing a form and leaving a review each have their own page, and each one can be embedded on your existing website with a short snippet.",
        points: [],
        mock: "bookingPage",
    },
];

export const payments = {
    eyebrow: "How payments work",
    title: "The money goes to your bank, and the records keep themselves.",
    lede: "Clientbridge uses Stripe Connect, so each business has its own Stripe account and its own payouts. We never hold your money.",
    steps: [
        {
            title: "The client pays",
            body: "By card online, by Tap to Pay in person, or by Interac e-Transfer using the reference code on the invoice.",
        },
        {
            title: "It is matched to the invoice",
            body: "Card payments mark the invoice paid straight away. An e-Transfer is matched by its reference code when it arrives.",
        },
        {
            title: "Stripe pays you out",
            body: "Your Stripe balance is paid out to your bank account. Each payout lists the payments, fees and refunds it covers.",
        },
        {
            title: "Tax is set aside",
            body: "The GST/HST you collected is tracked by period, with a return report ready to export and mark as filed.",
        },
    ],
};

export const included = {
    eyebrow: "Also included",
    title: "The rest of the business, in the same app.",
    items: [
        {
            icon: "gift",
            title: "Gift cards",
            body: "Sell them online or at the counter, and redeem them at checkout.",
        },
        {
            icon: "package",
            title: "Packages",
            body: "Prepaid bundles of visits, with sessions counted down as they are used.",
        },
        {
            icon: "subscription",
            title: "Subscriptions",
            body: "Monthly memberships charged to a saved card or by pre-authorized debit.",
        },
        {
            icon: "shop",
            title: "Online shop",
            body: "Clients order products from your booking site, pay by card and pick up. You mark each order ready.",
        },
        {
            icon: "stock",
            title: "Stock",
            body: "Optional stock counts per product, a low-stock list, and restock in a tap.",
        },
        {
            icon: "addon",
            title: "Add-ons at booking",
            body: "Clients add a product when they book, and it is added to the visit's invoice.",
        },
        {
            icon: "staff",
            title: "Staff and pay",
            body: "Roles for owners and staff, earnings on completed work, and pay records.",
        },
        {
            icon: "commission",
            title: "Retail commission",
            body: "A commission rate per staff member, recorded on each sale they make.",
        },
        {
            icon: "messaging",
            title: "Messaging",
            body: "Two-way text and email with clients, kept in one inbox per client.",
        },
        {
            icon: "reviews",
            title: "Reviews",
            body: "A review request goes out after each visit, and you choose what to show.",
        },
        {
            icon: "offline",
            title: "Works offline",
            body: "The schedule and client list stay on your device and sync when you reconnect.",
        },
        {
            icon: "reports",
            title: "Reports",
            body: "Income, GST/HST and T4A reports, exported as CSV for your bookkeeper.",
        },
    ] satisfies { icon: LineIconName; title: string; body: string }[],
};

export const proof = {
    eyebrow: "From businesses using Clientbridge",
    logo: "Customer logo",
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
        lead: `Testimonial placeholder ${String(n)}.`,
        body: "A short quote from a pilot customer about a specific outcome (for example, fewer unpaid invoices or less time on GST). To be replaced with a real, approved quote.",
        byline: "Name, business, city (to be confirmed)",
    };
}

export const pricing = {
    eyebrow: "Pricing",
    title: "One plan with everything in it.",
    body: "Every feature on this page is included. Card payments carry Stripe's standard processing fee, and Interac e-Transfers go bank to bank and are not charged a card fee.",
    price: "$[price]",
    per: " / month",
    note: "Placeholder. Final pricing to be confirmed.",
    points: [
        "Unlimited clients and bookings",
        "Products, stock and an online shop",
        "Web, iPhone and Android",
        "Staff seats [to be confirmed]",
    ],
    cta: "Start free",
};

export const closing = {
    title: "Try it with a business that is already set up.",
    lede: "The demo opens Birchbark Pet Studio, a grooming business in Victoria, with a full week of bookings, invoices and payments to look through.",
    primary: "Start free",
    secondary: "Open the demo",
};
