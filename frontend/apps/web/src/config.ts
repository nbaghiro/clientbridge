const env = import.meta.env;

export const config = {
    adminUrl: env.VITE_ADMIN_URL ?? "http://localhost:8711",
    apiUrl: env.VITE_API_URL ?? "http://localhost:8701",
    authUrl: env.VITE_AUTH_URL ?? "http://localhost:8713",
    powersyncUrl: env.VITE_POWERSYNC_URL ?? "http://localhost:8704",
    payUrl: env.VITE_PAY_URL ?? "http://localhost:8709",
    bookUrl: env.VITE_BOOK_URL ?? "http://localhost:8709",
    stripePublishableKey: env.VITE_STRIPE_PUBLISHABLE_KEY,
    dev: env.DEV,
    pseudoLocale: env.DEV && env.VITE_PSEUDO_LOCALE === "1",
};
