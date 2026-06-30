import type { ExpoConfig } from "expo/config";

// Apple Pay merchant id for the Stripe SDK (also the iOS in-app-payments entitlement the plugin adds).
const STRIPE_MERCHANT_ID = process.env.STRIPE_MERCHANT_ID ?? "merchant.ca.clientbridge.app";

// op-sqlite + @stripe/stripe-react-native are native modules → run via Expo dev build / EAS Build,
// NOT Expo Go (see docs/sync.md). The Stripe config plugin wires the native iOS/Android entitlements.
const config: ExpoConfig = {
    name: "Clientbridge",
    slug: "clientbridge",
    scheme: "clientbridge",
    version: "0.1.0",
    orientation: "portrait",
    ios: {
        supportsTablet: true,
        bundleIdentifier: "ca.clientbridge.app",
        infoPlist: { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } },
    },
    android: { package: "ca.clientbridge.app" },
    plugins: [
        [
            "@stripe/stripe-react-native",
            { merchantIdentifier: STRIPE_MERCHANT_ID, enableGooglePay: false },
        ],
    ],
    extra: {
        apiUrl: process.env.API_URL ?? "http://localhost:8701",
        powersyncUrl: process.env.POWERSYNC_URL ?? "http://localhost:8704",
        publicWebUrl: process.env.PUBLIC_WEB_URL ?? "https://app.clientbridge.ca",
        // Stripe publishable (platform) key — NOT a secret; left blank until configured per env.
        stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
        stripeMerchantId: STRIPE_MERCHANT_ID,
    },
};

export default config;
