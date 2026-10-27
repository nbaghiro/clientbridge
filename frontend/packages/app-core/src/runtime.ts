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

// Every server answers /config.js, loaded before each bundle: Caddy in the web image, the Vite plugin in dev and e2e.
export function runtimeConfig(): RuntimeConfig {
    const served = (globalThis as { __CLIENTBRIDGE_CONFIG__?: ServedConfig })
        .__CLIENTBRIDGE_CONFIG__;
    if (served === undefined) throw new Error("/config.js did not load before the app");
    const base = given(served.baseDomain);
    const url = (name: keyof ServedConfig, derived: (domain: string) => string): string => {
        const value = given(served[name]) ?? (base === undefined ? undefined : derived(base));
        if (value === undefined) throw new Error(`/config.js sets neither ${name} nor baseDomain`);
        return value;
    };
    return {
        get adminUrl() {
            return url("adminUrl", (domain) => `https://admin.${domain}`);
        },
        get webUrl() {
            return url("webUrl", (domain) => `https://app.${domain}`);
        },
        get apiUrl() {
            return url("apiUrl", (domain) => `https://api.${domain}`);
        },
        // the auth service is routed under the API host unless the served config names it
        get authUrl() {
            return given(served.authUrl) ?? `${this.apiUrl}/auth`;
        },
        get powersyncUrl() {
            return url("syncUrl", (domain) => `https://sync.${domain}`);
        },
        // each business's public page is a subdomain named by its slug
        get pageUrl() {
            return url("pageUrl", (domain) => `https://{slug}.${domain}`);
        },
        get bookUrl() {
            return url("bookUrl", (domain) => `https://book.${domain}`);
        },
        get shopUrl() {
            return url("shopUrl", (domain) => `https://shop.${domain}`);
        },
        get payUrl() {
            return url("payUrl", (domain) => `https://pay.${domain}`);
        },
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
