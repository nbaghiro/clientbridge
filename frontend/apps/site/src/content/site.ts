import { links } from "../config";
import { solutionPath, TRADES } from "./trades";

export interface NavLink {
    label: string;
    href: string;
}

export const nav = {
    skip: "Skip to content",
    home: "Clientbridge home",
    menu: "Menu",
    primary: "Primary",
    links: [
        { label: "Features", href: "/#features" },
        { label: "Solutions", href: "/solutions" },
        { label: "Payments", href: "/#payments" },
        { label: "Pricing", href: "/#pricing" },
    ] satisfies NavLink[],
    signIn: { label: "Sign in", href: links.signIn },
    startFree: { label: "Start free", href: links.startFree },
};

export const footer = {
    blurb: "Booking, invoices, payments and sales tax for service businesses in Canada.",
    columns: [
        {
            title: "Product",
            links: [
                { label: "Booking", href: "/#features" },
                { label: "Invoices and estimates", href: "/#features" },
                { label: "Payments", href: "/#payments" },
                { label: "Point of sale", href: "/#features" },
                { label: "Sales tax", href: "/#payments" },
            ],
        },
        {
            title: "Solutions",
            links: [
                ...TRADES.map((t) => ({ label: t.name, href: solutionPath(t.slug) })),
                { label: "All solutions", href: "/solutions" },
            ],
        },
        {
            title: "Company",
            links: [
                { label: "Pricing", href: "/#pricing" },
                { label: "Security", href: "/security" },
                { label: "Privacy", href: "/privacy" },
                { label: "Terms", href: "/terms" },
                { label: "Contact", href: "/contact" },
                { label: "Photo credits", href: "/credits" },
            ],
        },
    ] satisfies { title: string; links: NavLink[] }[],
    copyright: `© ${String(new Date().getFullYear())} Clientbridge`,
    legal: "Payments are processed by Stripe. Interac is a registered trade-mark of Interac Corp.",
};

export const notFound = {
    title: "Page not found",
    body: "The page you were looking for has moved or does not exist.",
    back: "Back to the home page",
};
