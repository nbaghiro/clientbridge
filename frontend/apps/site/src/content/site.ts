import { links } from "../config";
import { contactEmail } from "./pages";
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
        { label: "Features", href: "/features" },
        { label: "Solutions", href: "/solutions" },
        { label: "Payments", href: "/#payments" },
        { label: "Pricing", href: "/pricing" },
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
                { label: "Booking", href: "/features#bookings" },
                { label: "Invoices and estimates", href: "/features#invoices" },
                { label: "Payments", href: "/features#payments" },
                { label: "Products and stock", href: "/features#products" },
                { label: "Sales tax", href: "/features#tax" },
                { label: "Staff and pay", href: "/features#staff" },
                { label: "All features", href: "/features" },
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
                { label: "Pricing", href: "/pricing" },
                { label: "Privacy", href: "/privacy" },
                { label: "Terms", href: "/terms" },
                { label: "Contact", href: `mailto:${contactEmail}` },
                { label: "Photo credits", href: "/credits" },
            ],
        },
    ] satisfies { title: string; links: NavLink[] }[],
    copyright: `© ${String(new Date().getFullYear())} Clientbridge`,
    legal: "Interac is a registered trade-mark of Interac Corp.",
};

export const notFound = {
    title: "Page not found",
    body: "The page you were looking for has moved or does not exist.",
    back: "Back to the home page",
};
