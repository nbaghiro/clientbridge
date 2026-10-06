const env = import.meta.env;

export const config = {
    apiUrl: env.VITE_API_URL ?? "http://localhost:8701",
    powersyncUrl: env.VITE_POWERSYNC_URL ?? "http://localhost:8704",
    stripePublishableKey: env.VITE_STRIPE_PUBLISHABLE_KEY,
    dev: env.DEV,
};
