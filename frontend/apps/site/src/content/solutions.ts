import type { LineIconName } from "../art/LineIcon";
import type { PageMeta } from "../routes";
import type { Trade } from "./trades";

export const solutionsMeta: PageMeta = {
    title: "Clientbridge solutions",
    description:
        "How Clientbridge works for groomers, salons, trainers, cleaners, tutors, therapists, photographers and trades.",
};

export const tradeMeta = (t: Trade): PageMeta => ({
    title: `Clientbridge for ${t.name.toLowerCase()}`,
    description: t.oneLine,
});

export const solutionsPage = {
    eyebrow: "Solutions",
    title: "One app, set up for the way each trade books, bills and gets paid.",
    lede: "A groomer needs each pet's notes on the booking, a cleaner needs the entry instructions for each home, and a photographer needs a signed contract before the date is held. Clientbridge handles each of these with the same bookings, invoices, payments and sales tax underneath.",
    cardLink: (who: string) => `How it works for ${who}`,
    engineEyebrow: "The same engine underneath",
    engineTitle: "What every business gets, whatever the trade.",
    engine: [
        {
            icon: "booking",
            title: "Online booking",
            body: "Services with their own length, price, buffer and deposit, staff hours, classes with a capacity, and recurring visits.",
        },
        {
            icon: "invoice",
            title: "Invoices and estimates",
            body: "Built from the booking, numbered in order, and paid from a link by card or Interac e-Transfer.",
        },
        {
            icon: "tapToPay",
            title: "Tap to Pay",
            body: "Take a card in person on an iPhone or Android phone, with no separate card reader.",
        },
        {
            icon: "tax",
            title: "GST, HST, PST and QST",
            body: "Worked out from your province on every line, tracked by period, and ready for your return.",
        },
        {
            icon: "package",
            title: "Packages, memberships and gift cards",
            body: "Prepaid bundles that count down, monthly charges to a saved card or by pre-authorized debit, and gift cards.",
        },
        {
            icon: "staff",
            title: "Staff and pay",
            body: "Hours and services for each person, earnings on completed work, and T4A reports at year end.",
        },
        {
            icon: "messaging",
            title: "Reminders and messaging",
            body: "Reminders by text and email, and two-way messages kept in one inbox per client.",
        },
        {
            icon: "form",
            title: "Forms and reviews",
            body: "Intake forms, waivers and contracts signed online, and a review request after each visit.",
        },
        {
            icon: "offline",
            title: "Web, iPhone and Android",
            body: "The schedule and client list stay on your device when the connection drops, and sync when it returns.",
        },
    ] satisfies { icon: LineIconName; title: string; body: string }[],
    closing: {
        title: "Your trade is not listed here.",
        lede: "If you book appointments, send invoices and take payments in Canada, the same setup applies. Start with your services and hours, and the rest follows from there.",
        primary: "Start free",
        secondary: "Open the demo",
    },
};

export const tradePage = {
    crumb: "Solutions",
    primary: "Start free",
    secondary: "See the demo business",
    note: "Web, iPhone and Android. No card required to try it.",
    bookingsEyebrow: "Bookings",
    example: "Example data.",
    dayToDay: "Day to day",
    handles: (who: string) => `What Clientbridge handles for ${who}.`,
    gettingPaid: "Getting paid",
    clientsEyebrow: "Clients",
    bookingPage: "Your booking page",
    proofEyebrow: (who: string) => `From ${who} using Clientbridge`,
    others: "Other solutions",
    closing: {
        title: "Set up your services and open your booking page today.",
        lede: "Add your services, hours and staff, connect Stripe for payouts, and share your booking page. You can also open the demo business to look around first.",
        primary: "Start free",
        secondary: "Open the demo",
    },
    scheduleTitle: "Schedule",
    scheduleViews: ["Day", "Week", "Month"],
    subtotal: "Subtotal",
    total: "Total",
    inCad: (amount: string) => `${amount} CAD`,
    depositPaid: "Deposit paid at booking",
    paidToday: "Paid today",
    retainerPaid: (pct: number) => `Retainer ${String(pct)}% · paid`,
    balanceDue: "Balance before delivery",
    clients: "Clients",
    students: "Students",
    plan: "Package",
    used: (used: number, total: number) => `${String(used)} of ${String(total)} used`,
    upcoming: "Upcoming",
    forms: "Forms",
    signed: (form: string) => `${form} · signed`,
};

export const creditsMeta: PageMeta = {
    title: "Photo credits | Clientbridge",
    description: "The photographers whose work appears on the Clientbridge website.",
};

export const creditsPage = {
    title: "Photo credits",
    lede: "The photos on this site are from Pexels and are used under the Pexels License, which allows commercial use without attribution. We list the photographers here as a courtesy.",
    license: "Pexels License",
    licenseUrl: "https://www.pexels.com/license/",
    photoBy: (name: string) => `Photo by ${name}`,
    columns: { subject: "Photo", photographer: "Photographer", source: "Source" },
    view: "View on Pexels",
};
