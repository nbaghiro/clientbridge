import { connectSite, runtimeConfig } from "@clientbridge/app-core/public";

const env = import.meta.env;
const served = runtimeConfig();

const urls = {
    pageUrl: served.pageUrl,
    bookUrl: served.bookUrl,
    shopUrl: served.shopUrl,
    payUrl: served.payUrl,
};

export const config = {
    apiUrl: served.apiUrl,
    stripePublishableKey: served.stripePublishableKey,
    pseudoLocale: env.DEV && env.VITE_PSEUDO_LOCALE === "1",
    urls,
    site: connectSite(window.location.origin, urls),
};
