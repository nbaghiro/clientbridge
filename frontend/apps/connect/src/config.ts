import { runtimeConfig } from "@clientbridge/app-core/public";

const env = import.meta.env;
const deployed = runtimeConfig();

export const config = {
    apiUrl: deployed?.apiUrl ?? env.VITE_API_URL ?? "http://127.0.0.1:8701",
    stripePublishableKey: deployed
        ? deployed.stripePublishableKey
        : env.VITE_STRIPE_PUBLISHABLE_KEY,
    pseudoLocale: env.DEV && env.VITE_PSEUDO_LOCALE === "1",
};
