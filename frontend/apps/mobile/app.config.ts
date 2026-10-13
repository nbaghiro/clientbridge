import type { ExpoConfig } from "expo/config";

// expo-modules-core widens ProcessEnv's values to any; config values are strings or unset.
const env: Record<string, string | undefined> = process.env;

// Apple Pay merchant id for the Stripe SDK (also the iOS in-app-payments entitlement the plugin adds).
const STRIPE_MERCHANT_ID = env.STRIPE_MERCHANT_ID ?? "merchant.ca.clientbridge.app";

// Native modules (op-sqlite, Stripe) need an Expo dev build, not Expo Go; see .docs/engineering.md.
const config: ExpoConfig = {
    name: "Clientbridge",
    slug: "clientbridge",
    scheme: "clientbridge",
    version: "0.1.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    // Permission prompts and the display name, per language; Expo writes InfoPlist.strings and strings.xml.
    locales: { en: "./locales/en.json" },
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
        [
            "expo-splash-screen",
            {
                image: "./assets/splash-icon.png",
                imageWidth: 144,
                resizeMode: "contain",
                backgroundColor: "#F3F4F6",
            },
        ],
        "expo-sharing",
        ["expo-image-picker", { cameraPermission: false, microphonePermission: false }],
        ["expo-localization", { supportedLocales: ["en"] }],
        ["expo-notifications", { icon: "./assets/notification-icon.png", color: "#3F5E80" }],
        [
            "@stripe/stripe-react-native",
            { merchantIdentifier: STRIPE_MERCHANT_ID, enableGooglePay: false },
        ],
        // Tap to Pay; the plugin reads its options without a null check, so pass an object.
        ["@stripe/stripe-terminal-react-native", {}],
        // minSdk 26 for Stripe Terminal; E2E_CLEARTEXT lets the CI release build reach a local http API.
        [
            "expo-build-properties",
            {
                android: {
                    minSdkVersion: 26,
                    ...(env.E2E_CLEARTEXT === "1" ? { usesCleartextTraffic: true } : {}),
                },
            },
        ],
    ],
    extra: {
        apiUrl: env.API_URL ?? "http://127.0.0.1:8701",
        powersyncUrl: env.POWERSYNC_URL ?? "http://127.0.0.1:8704",
        authUrl: env.AUTH_URL ?? "http://127.0.0.1:8713",
        publicWebUrl: env.PUBLIC_WEB_URL ?? "https://app.clientbridge.ca",
        payUrl: env.PAY_URL ?? "https://pay.clientbridge.ca",
        bookUrl: env.BOOK_URL ?? "https://book.clientbridge.ca",
        // Stripe publishable (platform) key — NOT a secret; left blank until configured per env.
        stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY ?? "",
        stripeMerchantId: STRIPE_MERCHANT_ID,
        terminalSimulated: (env.STRIPE_TERMINAL_SIMULATED ?? "true") === "true",
    },
};

export default config;
