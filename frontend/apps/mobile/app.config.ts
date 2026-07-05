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
    icon: "./assets/icon.png",
    ios: {
        supportsTablet: true,
        bundleIdentifier: "ca.clientbridge.app",
        infoPlist: { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } },
    },
    android: {
        package: "ca.clientbridge.app",
        adaptiveIcon: {
            foregroundImage: "./assets/adaptive-icon.png",
            backgroundColor: "#3f5e80",
        },
    },
    plugins: [
        [
            "@stripe/stripe-react-native",
            { merchantIdentifier: STRIPE_MERCHANT_ID, enableGooglePay: false },
        ],
        // POS card-present (Tap to Pay). Its config plugin adds the iOS/Android entitlements +
        // permissions; needs an EAS dev build + a Tap-to-Pay-capable device (or a simulated reader).
        "@stripe/stripe-terminal-react-native",
    ],
    extra: {
        apiUrl: process.env.API_URL ?? "http://localhost:8701",
        powersyncUrl: process.env.POWERSYNC_URL ?? "http://localhost:8704",
        publicWebUrl: process.env.PUBLIC_WEB_URL ?? "https://app.clientbridge.ca",
        // Stripe publishable (platform) key — NOT a secret; left blank until configured per env.
        stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
        stripeMerchantId: STRIPE_MERCHANT_ID,
        // Stripe Terminal location id for connecting a Tap-to-Pay reader (the backend doesn't mint
        // one yet — set it from the Stripe dashboard). Empty + simulated=true uses a test reader.
        stripeTerminalLocationId: process.env.STRIPE_TERMINAL_LOCATION_ID ?? "",
        terminalSimulated: (process.env.STRIPE_TERMINAL_SIMULATED ?? "true") === "true",
    },
};

export default config;
