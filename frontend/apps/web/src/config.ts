import { runtimeConfig } from "@clientbridge/app-core";

const env = import.meta.env;
const served = runtimeConfig();

export const config = {
    adminUrl: served.adminUrl,
    apiUrl: served.apiUrl,
    authUrl: served.authUrl,
    powersyncUrl: served.powersyncUrl,
    pageUrl: served.pageUrl,
    bookUrl: served.bookUrl,
    shopUrl: served.shopUrl,
    payUrl: served.payUrl,
    stripePublishableKey: served.stripePublishableKey,
    dev: env.DEV,
    pseudoLocale: env.DEV && env.VITE_PSEUDO_LOCALE === "1",
};
