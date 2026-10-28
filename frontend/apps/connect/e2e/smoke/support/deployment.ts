import { expect, type BrowserContext, type Page } from "@playwright/test";

const domain = process.env.SMOKE_DOMAIN ?? "staging.clientbridge.ca";
const scheme = process.env.SMOKE_SCHEME ?? "https";

/** A deployed environment's hosts; each can be overridden on its own. */
export const deployment = {
    domain,
    scheme,
    api: process.env.SMOKE_API_URL ?? `${scheme}://api.${domain}`,
    app: process.env.SMOKE_APP_URL ?? `${scheme}://app.${domain}`,
    site: process.env.SMOKE_SITE_URL ?? `${scheme}://${domain}`,
    book: process.env.SMOKE_BOOK_URL ?? `${scheme}://book.${domain}`,
    shop: process.env.SMOKE_SHOP_URL ?? `${scheme}://shop.${domain}`,
    pay: process.env.SMOKE_PAY_URL ?? `${scheme}://pay.${domain}`,
    pageTemplate: process.env.SMOKE_PAGE_URL ?? `${scheme}://{slug}.${domain}`,
    slug: process.env.SMOKE_SLUG ?? "birchbark",
    business: process.env.SMOKE_BUSINESS ?? "Birchbark Pet Studio",
    password: process.env.SMOKE_PASSWORD ?? "demo1234",
    owners: (
        process.env.SMOKE_OWNERS ??
        [
            "hannah@birchbark.example",
            ...[
                "cedarcoast",
                "northlight",
                "brightwater",
                "maplemain",
                "ridgeline",
                "lakeside",
                "harbourside",
                "fieldnote",
                "foothills",
                "inkwell",
                "clearcoat",
                "riverbend",
            ].map((slug) => `owner@${slug}.example`),
        ].join(",")
    )
        .split(",")
        .map((owner) => owner.trim())
        .filter(Boolean),
};

export function businessPage(slug: string = deployment.slug, path = ""): string {
    return deployment.pageTemplate.replace("{slug}", slug) + path;
}

// Signing in and the payment setup's short-lived Stripe session are the only writes allowed.
const ALLOWED = [/^\/auth\/self-service\/login$/, /^\/v1\/connect\/session$/];

/** Aborts and records every write to the deployment, so a smoke run never changes its data. */
export async function readOnly(context: BrowserContext): Promise<string[]> {
    const writes: string[] = [];
    await context.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const ours = url.hostname === domain || url.hostname.endsWith(`.${domain}`);
        const allowed =
            !ours ||
            ["GET", "HEAD", "OPTIONS"].includes(request.method()) ||
            (url.origin === deployment.api && ALLOWED.some((path) => path.test(url.pathname)));
        if (allowed) {
            await route.fallback();
            return;
        }
        writes.push(`${request.method()} ${url.origin}${url.pathname}`);
        await route.abort("blockedbyclient");
    });
    return writes;
}

export function pageErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error")
            errors.push(`${message.text()} @ ${message.location().url}`);
    });
    return errors;
}

export function expectNoWrites(writes: string[]): void {
    expect(writes, "a smoke test tried to change the deployed environment").toEqual([]);
}
