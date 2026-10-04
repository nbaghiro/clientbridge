import { config } from "./config";
import type { PageMeta } from "./routes";

const escape = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The per-page <head> tags the build writes into each HTML file. */
export function headTags(meta: PageMeta, path: string): string {
    const url = `${config.siteUrl}${path === "/" ? "/" : path}`;
    const title = escape(meta.title);
    const description = escape(meta.description);
    return [
        `<title>${title}</title>`,
        `<meta name="description" content="${description}" />`,
        `<link rel="canonical" href="${escape(url)}" />`,
        `<meta property="og:type" content="website" />`,
        `<meta property="og:site_name" content="Clientbridge" />`,
        `<meta property="og:title" content="${title}" />`,
        `<meta property="og:description" content="${description}" />`,
        `<meta property="og:url" content="${escape(url)}" />`,
        `<meta name="twitter:card" content="summary_large_image" />`,
        `<meta name="theme-color" content="#ffffff" />`,
    ].join("\n        ");
}
