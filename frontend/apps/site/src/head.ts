import { config } from "./config";
import type { PageMeta } from "./routes";

const escape = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const OG_SIZE = { width: 1200, height: 630 };

/** The share image the build draws for a page: "/" → og/home.png, "/solutions/x" → og/solutions-x.png. */
export const ogImageFor = (path: string): string =>
    `og/${path === "/" || path === "/404" ? "home" : path.replace(/^\//, "").replace(/\//g, "-")}.png`;

const homeJsonLd = (): string =>
    JSON.stringify([
        {
            "@context": "https://schema.org",
            "@type": "Organization",
            name: "Clientbridge",
            url: `${config.siteUrl}/`,
            logo: `${config.siteUrl}/icon-512.png`,
        },
        {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "Clientbridge",
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web, iOS, Android",
            url: `${config.siteUrl}/`,
            description:
                "Booking, invoices, payments and sales tax for service businesses in Canada.",
        },
    ]).replace(/</g, "\\u003c");

export function headTags(meta: PageMeta, path: string): string {
    const url = `${config.siteUrl}${path === "/" ? "/" : path}`;
    const title = escape(meta.title);
    const description = escape(meta.description);
    const image = escape(`${config.siteUrl}/${ogImageFor(path)}`);
    const tags = [
        `<title>${title}</title>`,
        `<meta name="description" content="${description}" />`,
        `<link rel="canonical" href="${escape(url)}" />`,
        `<meta property="og:type" content="website" />`,
        `<meta property="og:site_name" content="Clientbridge" />`,
        `<meta property="og:locale" content="en_CA" />`,
        `<meta property="og:title" content="${title}" />`,
        `<meta property="og:description" content="${description}" />`,
        `<meta property="og:url" content="${escape(url)}" />`,
        `<meta property="og:image" content="${image}" />`,
        `<meta property="og:image:width" content="${String(OG_SIZE.width)}" />`,
        `<meta property="og:image:height" content="${String(OG_SIZE.height)}" />`,
        `<meta name="twitter:card" content="summary_large_image" />`,
        `<meta name="twitter:title" content="${title}" />`,
        `<meta name="twitter:description" content="${description}" />`,
        `<meta name="twitter:image" content="${image}" />`,
        `<link rel="manifest" href="/site.webmanifest" />`,
        `<meta name="theme-color" content="#ffffff" />`,
    ];
    if (path === "/404") tags.push(`<meta name="robots" content="noindex" />`);
    if (path === "/") tags.push(`<script type="application/ld+json">${homeJsonLd()}</script>`);
    return tags.join("\n        ");
}
