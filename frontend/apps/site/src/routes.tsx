import type { ComponentType } from "react";

import { config } from "./config";
import { homeMeta } from "./content/home";
import { notFound } from "./content/site";
import {
    contactPage,
    featuresMeta,
    pageMeta,
    paymentsMeta,
    pricingMeta,
    privacyPage,
    termsPage,
} from "./content/pages";
import { solutionsMeta, tradeMeta } from "./content/solutions";
import { solutionPath, type Trade, TRADES } from "./content/trades";
import { waitlistPage } from "./content/waitlist";
import { Contact, ContactThanks } from "./pages/Contact";
import { FeaturesPage } from "./pages/Features";
import { Home } from "./pages/Home";
import { Legal } from "./pages/Legal";
import { NotFound } from "./pages/NotFound";
import { PaymentsPage } from "./pages/Payments";
import { PricingPage } from "./pages/Pricing";
import { Solutions } from "./pages/Solutions";
import { TradePage } from "./pages/TradePage";
import { Waitlist, WaitlistThanks } from "./pages/Waitlist";

export interface PageMeta {
    title: string;
    /** The share image's heading: the title without the brand. */
    headline: string;
    description: string;
}

export interface SiteRoute {
    path: string;
    Page: ComponentType;
    meta: PageMeta;
    /** Left out of the sitemap and marked noindex: pages a visitor only reaches by acting. */
    hidden?: boolean;
}

function tradeRoute(trade: Trade): SiteRoute {
    function Page() {
        return <TradePage trade={trade} />;
    }
    return { path: solutionPath(trade.slug), Page, meta: tradeMeta(trade) };
}

// The server answers the form's POST with the thanks or the retry page.
const WAITLIST_ROUTES: SiteRoute[] = [
    { path: "/waitlist", Page: () => <Waitlist />, meta: waitlistPage.meta },
    {
        path: "/waitlist/retry",
        Page: () => <Waitlist retry />,
        meta: waitlistPage.meta,
        hidden: true,
    },
    { path: "/waitlist/thanks", Page: WaitlistThanks, meta: waitlistPage.thanksMeta, hidden: true },
];

export const ROUTES: readonly SiteRoute[] = [
    { path: "/", Page: Home, meta: homeMeta },
    { path: "/solutions", Page: Solutions, meta: solutionsMeta },
    ...TRADES.map(tradeRoute),
    { path: "/features", Page: FeaturesPage, meta: featuresMeta },
    { path: "/payments", Page: PaymentsPage, meta: paymentsMeta },
    { path: "/pricing", Page: PricingPage, meta: pricingMeta },
    { path: "/privacy", Page: () => <Legal page={privacyPage} />, meta: privacyPage.meta },
    { path: "/terms", Page: () => <Legal page={termsPage} />, meta: termsPage.meta },
    { path: "/contact", Page: () => <Contact />, meta: contactPage.meta },
    { path: "/contact/retry", Page: () => <Contact retry />, meta: contactPage.meta, hidden: true },
    { path: "/contact/thanks", Page: ContactThanks, meta: contactPage.thanksMeta, hidden: true },
    ...(config.waitlist ? WAITLIST_ROUTES : []),
];

export const NOT_FOUND: SiteRoute = {
    path: "/404",
    Page: NotFound,
    meta: pageMeta({ headline: notFound.title, description: notFound.body }),
    hidden: true,
};

export const routeFor = (path: string): SiteRoute => {
    const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
    return ROUTES.find((r) => r.path === clean) ?? NOT_FOUND;
};

/** The output file for a route: "/" → index.html, "/solutions" → solutions/index.html. */
export const fileFor = (route: SiteRoute): string =>
    route === NOT_FOUND
        ? "404.html"
        : `${route.path.replace(/^\//, "")}${route.path === "/" ? "" : "/"}index.html`;
