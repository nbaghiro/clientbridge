import { runtimeConfig } from "@clientbridge/app-core";

const env = import.meta.env;
const deployed = runtimeConfig();

export const config = {
    adminUrl: deployed?.adminUrl ?? env.VITE_ADMIN_URL ?? "http://localhost:8711",
    apiUrl: deployed?.apiUrl ?? env.VITE_API_URL ?? "http://localhost:8701",
    authUrl: deployed?.authUrl ?? env.VITE_AUTH_URL ?? "http://localhost:8713",
    powersyncUrl: deployed?.powersyncUrl ?? env.VITE_POWERSYNC_URL ?? "http://localhost:8704",
    payUrl: deployed?.payUrl ?? env.VITE_PAY_URL ?? "http://localhost:8709",
    bookUrl: deployed?.bookUrl ?? env.VITE_BOOK_URL ?? "http://localhost:8709",
    stripePublishableKey: deployed
        ? deployed.stripePublishableKey
        : env.VITE_STRIPE_PUBLISHABLE_KEY,
    dev: env.DEV,
    pseudoLocale: env.DEV && env.VITE_PSEUDO_LOCALE === "1",
};
