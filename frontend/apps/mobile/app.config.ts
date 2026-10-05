import type { ExpoConfig } from "expo/config";

// Apple Pay merchant id for the Stripe SDK (also the iOS in-app-payments entitlement the plugin adds).
const STRIPE_MERCHANT_ID = process.env.STRIPE_MERCHANT_ID ?? "merchant.ca.clientbridge.app";

// Native modules (op-sqlite, Stripe) need an Expo dev build, not Expo Go; see .docs/engineering.md.
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
            backgroundColor: "#3F5E80",
        },
    },
    plugins: [
        ["expo-notifications", { icon: "./assets/notification-icon.png", color: "#3F5E80" }],
        [
            "@stripe/stripe-react-native",
            { merchantIdentifier: STRIPE_MERCHANT_ID, enableGooglePay: false },
        ],
        // Tap to Pay; the plugin reads its options without a null check, so pass an object.
        ["@stripe/stripe-terminal-react-native", {}],
        // Stripe Terminal's Android SDK requires minSdk 26 (React Native defaults to 24).
        ["expo-build-properties", { android: { minSdkVersion: 26 } }],
    ],
    extra: {
        apiUrl: process.env.API_URL ?? "http://localhost:8701",
        powersyncUrl: process.env.POWERSYNC_URL ?? "http://localhost:8704",
        publicWebUrl: process.env.PUBLIC_WEB_URL ?? "https://app.clientbridge.ca",
        // Stripe publishable (platform) key — NOT a secret; left blank until configured per env.
        stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
        stripeMerchantId: STRIPE_MERCHANT_ID,
        // Set from the Stripe dashboard for now; empty with simulated=true uses a test reader.
        stripeTerminalLocationId: process.env.STRIPE_TERMINAL_LOCATION_ID ?? "",
        terminalSimulated: (process.env.STRIPE_TERMINAL_SIMULATED ?? "true") === "true",
    },
};

export default config;
