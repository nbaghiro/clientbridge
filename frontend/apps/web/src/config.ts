const env = import.meta.env;

export const config = {
    apiUrl: env.VITE_API_URL ?? "http://127.0.0.1:8701",
    powersyncUrl: env.VITE_POWERSYNC_URL ?? "http://localhost:8704",
    payUrl: env.VITE_PAY_URL ?? "http://localhost:8709",
    bookUrl: env.VITE_BOOK_URL ?? "http://localhost:8709",
    stripePublishableKey: env.VITE_STRIPE_PUBLISHABLE_KEY,
    dev: env.DEV,
};
