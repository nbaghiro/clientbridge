import type { LineIconName } from "../art/LineIcon";
import type { PageMeta } from "../routes";
import type { Trade } from "./trades";
import { closingButton, closingCopy, ctaLabel, ctaNote } from "./waitlist";
import { strings } from "../strings";

const s = strings.solutions;

export const solutionsMeta: PageMeta = {
    title: s.solutionsMeta.title,
    headline: s.solutionsMeta.title,
    description: s.solutionsMeta.description,
};

export const tradeMeta = (t: Trade): PageMeta => {
    const title = s.tradeMeta.title(t.name.toLowerCase());
    return { title, headline: title, description: t.oneLine };
};

export const solutionsPage = {
    eyebrow: s.solutionsPage.eyebrow,
    title: s.solutionsPage.title,
    lede: s.solutionsPage.lede,
    cardLink: s.solutionsPage.cardLink,
    engineEyebrow: s.solutionsPage.engineEyebrow,
    engineTitle: s.solutionsPage.engineTitle,
    engine: [
        {
            icon: "booking",
            title: s.solutionsPage.engine[0].title,
            body: s.solutionsPage.engine[0].body,
        },
        {
            icon: "invoice",
            title: s.solutionsPage.engine[1].title,
            body: s.solutionsPage.engine[1].body,
        },
        {
            icon: "tapToPay",
            title: s.solutionsPage.engine[2].title,
            body: s.solutionsPage.engine[2].body,
        },
        {
            icon: "tax",
            title: s.solutionsPage.engine[3].title,
            body: s.solutionsPage.engine[3].body,
        },
        {
            icon: "package",
            title: s.solutionsPage.engine[4].title,
            body: s.solutionsPage.engine[4].body,
        },
        {
            icon: "staff",
            title: s.solutionsPage.engine[5].title,
            body: s.solutionsPage.engine[5].body,
        },
        {
            icon: "messaging",
            title: s.solutionsPage.engine[6].title,
            body: s.solutionsPage.engine[6].body,
        },
        {
            icon: "form",
            title: s.solutionsPage.engine[7].title,
            body: s.solutionsPage.engine[7].body,
        },
        {
            icon: "offline",
            title: s.solutionsPage.engine[8].title,
            body: s.solutionsPage.engine[8].body,
        },
    ] satisfies { icon: LineIconName; title: string; body: string }[],
    closing: closingButton(s.solutionsPage.closing),
};

export const tradePage = {
    crumb: s.tradePage.crumb,
    primary: ctaLabel(s.tradePage.primary),
    secondary: s.tradePage.secondary,
    note: ctaNote(s.tradePage.note),
    bookingsEyebrow: s.tradePage.bookingsEyebrow,
    example: s.tradePage.example,
    dayToDay: s.tradePage.dayToDay,
    handles: s.tradePage.handles,
    gettingPaid: s.tradePage.gettingPaid,
    clientsEyebrow: s.tradePage.clientsEyebrow,
    bookingPage: s.tradePage.bookingPage,
    bookingTag: s.tradePage.bookingTag,
    others: s.tradePage.others,
    closing: closingCopy(s.tradePage.closing),
    scheduleTitle: s.tradePage.scheduleTitle,
    scheduleViews: s.tradePage.scheduleViews,
    subtotal: s.tradePage.subtotal,
    total: s.tradePage.total,
    inCad: s.tradePage.inCad,
    depositPaid: s.tradePage.depositPaid,
    paidToday: s.tradePage.paidToday,
    retainerPaid: s.tradePage.retainerPaid,
    balanceDue: s.tradePage.balanceDue,
    clients: s.tradePage.clients,
    students: s.tradePage.students,
    plan: s.tradePage.plan,
    used: s.tradePage.used,
    upcoming: s.tradePage.upcoming,
    forms: s.tradePage.forms,
    signed: s.tradePage.signed,
};
