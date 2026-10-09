const env = import.meta.env;

export const config = {
    apiUrl: env.VITE_API_URL ?? "http://127.0.0.1:8701",
    stripePublishableKey: env.VITE_STRIPE_PUBLISHABLE_KEY,
};
