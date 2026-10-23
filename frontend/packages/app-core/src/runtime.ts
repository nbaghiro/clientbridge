interface RuntimeConfig {
    readonly adminUrl: string;
    readonly webUrl: string;
    readonly apiUrl: string;
    readonly authUrl: string;
    readonly powersyncUrl: string;
    readonly pageUrl: string;
    readonly bookUrl: string;
    readonly shopUrl: string;
    readonly payUrl: string;
    readonly stripePublishableKey: string | undefined;
}

interface ServedConfig {
    readonly adminUrl?: unknown;
    readonly webUrl?: unknown;
    readonly baseDomain?: unknown;
    readonly apiUrl?: unknown;
    readonly authUrl?: unknown;
    readonly syncUrl?: unknown;
    readonly pageUrl?: unknown;
    readonly bookUrl?: unknown;
    readonly shopUrl?: unknown;
    readonly payUrl?: unknown;
    readonly stripePublishableKey?: unknown;
}

function given(value: unknown): string | undefined {
    return typeof value === "string" && value !== "" ? value : undefined;
}

// The web image serves /config.js, loaded before each bundle; dev servers serve an empty one.
export function runtimeConfig(): RuntimeConfig | null {
    const served = (globalThis as { __CLIENTBRIDGE_CONFIG__?: ServedConfig })
        .__CLIENTBRIDGE_CONFIG__;
    const base = given(served?.baseDomain);
    if (served === undefined || base === undefined) return null;
    const apiUrl = given(served.apiUrl) ?? `https://api.${base}`;
    return {
        adminUrl: given(served.adminUrl) ?? `https://admin.${base}`,
        webUrl: given(served.webUrl) ?? `https://app.${base}`,
        apiUrl,
        // the auth service is routed under the API host unless the served config names it
        authUrl: given(served.authUrl) ?? `${apiUrl}/auth`,
        powersyncUrl: given(served.syncUrl) ?? `https://sync.${base}`,
        // each business's public page is a subdomain named by its slug
        pageUrl: given(served.pageUrl) ?? `https://{slug}.${base}`,
        bookUrl: given(served.bookUrl) ?? `https://book.${base}`,
        shopUrl: given(served.shopUrl) ?? `https://shop.${base}`,
        payUrl: given(served.payUrl) ?? `https://pay.${base}`,
        stripePublishableKey: given(served.stripePublishableKey),
    };
}

interface ConnectUrls {
    readonly pageUrl: string;
    readonly bookUrl: string;
    readonly shopUrl: string;
    readonly payUrl: string;
}

type ConnectSite =
    { readonly kind: "page"; readonly slug: string } | { readonly kind: "book" | "shop" | "pay" };

const SLUG = "{slug}";

function trimmed(url: string): string {
    return url.replace(/\/+$/, "");
}

export function businessPageUrl(pageUrl: string, slug: string): string {
    return trimmed(pageUrl).replace(SLUG, slug);
}

export function bookingPageUrl(bookUrl: string, slug: string): string {
    return `${trimmed(bookUrl)}/${slug}`;
}

export function shopPageUrl(shopUrl: string, slug: string): string {
    return `${trimmed(shopUrl)}/${slug}`;
}

/** A link as staff screens print it, without the scheme. */
export function bareUrl(url: string): string {
    return url.replace(/^https?:\/\//, "");
}

/** The domain every business page is a subdomain of, shown after the slug field. */
export function pageDomain(pageUrl: string): string {
    return bareUrl(trimmed(pageUrl)).replace(`${SLUG}.`, "");
}

/** Which Connect site an origin serves; a business page's slug is its first host label. */
export function connectSite(origin: string, urls: ConnectUrls): ConnectSite | null {
    const sites = [
        ["book", urls.bookUrl],
        ["shop", urls.shopUrl],
        ["pay", urls.payUrl],
    ] as const;
    const found = sites.find(([, url]) => new URL(url).origin === origin);
    if (found) return { kind: found[0] };
    const [scheme, domain] = trimmed(urls.pageUrl).split(`//${SLUG}.`);
    if (domain === undefined) return null;
    const { protocol, host } = new URL(origin);
    const label = host.slice(0, -domain.length - 1);
    return protocol === scheme && host === `${label}.${domain}` && /^[a-z0-9-]+$/.test(label)
        ? { kind: "page", slug: label }
        : null;
}
