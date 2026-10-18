interface RuntimeConfig {
    readonly adminUrl: string;
    readonly webUrl: string;
    readonly apiUrl: string;
    readonly authUrl: string;
    readonly powersyncUrl: string;
    readonly payUrl: string;
    readonly bookUrl: string;
    readonly stripePublishableKey: string | undefined;
}

interface ServedConfig {
    readonly adminUrl?: unknown;
    readonly webUrl?: unknown;
    readonly baseDomain?: unknown;
    readonly apiUrl?: unknown;
    readonly authUrl?: unknown;
    readonly syncUrl?: unknown;
    readonly payUrl?: unknown;
    readonly bookUrl?: unknown;
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
        payUrl: given(served.payUrl) ?? `https://pay.${base}`,
        bookUrl: given(served.bookUrl) ?? `https://book.${base}`,
        stripePublishableKey: given(served.stripePublishableKey),
    };
}
