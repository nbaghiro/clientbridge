const env = import.meta.env;

export const config = {
    apiUrl: env.VITE_API_URL ?? "http://localhost:8701",
    stripePublishableKey: env.VITE_STRIPE_PUBLISHABLE_KEY,
};
