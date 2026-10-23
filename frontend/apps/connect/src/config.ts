import { connectSite, runtimeConfig } from "@clientbridge/app-core/public";

const env = import.meta.env;
const deployed = runtimeConfig();
const port = window.location.port === "" ? "" : `:${window.location.port}`;
// the dev and e2e servers answer every *.localhost name on their own port
const local = (label: string): string => `http://${label}.localhost${port}`;

const urls = {
    pageUrl: deployed?.pageUrl ?? env.VITE_PAGE_URL ?? local("{slug}"),
    bookUrl: deployed?.bookUrl ?? env.VITE_BOOK_URL ?? local("book"),
    shopUrl: deployed?.shopUrl ?? env.VITE_SHOP_URL ?? local("shop"),
    payUrl: deployed?.payUrl ?? env.VITE_PAY_URL ?? local("pay"),
};

export const config = {
    apiUrl: deployed?.apiUrl ?? env.VITE_API_URL ?? "http://127.0.0.1:8701",
    stripePublishableKey: deployed
        ? deployed.stripePublishableKey
        : env.VITE_STRIPE_PUBLISHABLE_KEY,
    pseudoLocale: env.DEV && env.VITE_PSEUDO_LOCALE === "1",
    urls,
    site: connectSite(window.location.origin, urls),
};
