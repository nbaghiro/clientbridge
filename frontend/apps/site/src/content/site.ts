import { links } from "../config";
import { contactEmail } from "./pages";
import { solutionPath, TRADES } from "./trades";
import { strings } from "../strings";

const s = strings.site;

export interface NavLink {
    label: string;
    href: string;
}

export const nav = {
    skip: s.nav.skip,
    home: s.nav.home,
    menu: s.nav.menu,
    primary: s.nav.primary,
    links: [
        { label: s.nav.links[0].label, href: "/features" },
        { label: s.nav.links[1].label, href: "/solutions" },
        { label: s.nav.links[2].label, href: "/#payments" },
        { label: s.nav.links[3].label, href: "/pricing" },
    ] satisfies NavLink[],
    signIn: { label: s.nav.signIn.label, href: links.signIn },
    startFree: { label: s.nav.startFree.label, href: links.startFree },
};

export const footer = {
    blurb: s.footer.blurb,
    columns: [
        {
            title: s.footer.columns[0].title,
            links: [
                { label: s.footer.columns[0].links[0].label, href: "/features#bookings" },
                { label: s.footer.columns[0].links[1].label, href: "/features#invoices" },
                { label: s.footer.columns[0].links[2].label, href: "/features#payments" },
                { label: s.footer.columns[0].links[3].label, href: "/features#products" },
                { label: s.footer.columns[0].links[4].label, href: "/features#tax" },
                { label: s.footer.columns[0].links[5].label, href: "/features#staff" },
                { label: s.footer.columns[0].links[6].label, href: "/features" },
            ],
        },
        {
            title: s.footer.columns[1].title,
            links: [
                ...TRADES.map((t) => ({ label: t.name, href: solutionPath(t.slug) })),
                { label: s.footer.columns[1].links[1].label, href: "/solutions" },
            ],
        },
        {
            title: s.footer.columns[2].title,
            links: [
                { label: s.footer.columns[2].links[0].label, href: "/pricing" },
                { label: s.footer.columns[2].links[1].label, href: "/privacy" },
                { label: s.footer.columns[2].links[2].label, href: "/terms" },
                { label: s.footer.columns[2].links[3].label, href: `mailto:${contactEmail}` },
                { label: s.footer.columns[2].links[4].label, href: "/credits" },
            ],
        },
    ] satisfies { title: string; links: NavLink[] }[],
    copyright: s.footer.copyright(String(new Date().getFullYear())),
    legal: s.footer.legal,
};

export const notFound = s.notFound;
