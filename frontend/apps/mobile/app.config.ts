import type { ExpoConfig } from "expo/config";

// expo-modules-core widens ProcessEnv's values to any; config values are strings or unset.
const env: Record<string, string | undefined> = process.env;

// EAS builds set BASE_DOMAIN and get the deployed hosts; the auth service is at api.<base>/auth.
const deployed = (host: string, path = ""): string | undefined =>
    env.BASE_DOMAIN ? `https://${host}.${env.BASE_DOMAIN}${path}` : undefined;

// without it a staging or store build would ship the local development URLs
if (["staging", "production"].includes(env.EAS_BUILD_PROFILE ?? "") && !env.BASE_DOMAIN) {
    throw new Error(`the ${env.EAS_BUILD_PROFILE ?? ""} build profile needs BASE_DOMAIN`);
}

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
        apiUrl: env.API_URL ?? deployed("api") ?? "http://127.0.0.1:8701",
        powersyncUrl: env.POWERSYNC_URL ?? deployed("sync") ?? "http://127.0.0.1:8704",
        authUrl: env.AUTH_URL ?? deployed("api", "/auth") ?? "http://127.0.0.1:8713",
        publicWebUrl: env.PUBLIC_WEB_URL ?? deployed("app") ?? "http://localhost:8700",
        payUrl: env.PAY_URL ?? deployed("pay") ?? "http://localhost:8709",
        bookUrl: env.BOOK_URL ?? deployed("book") ?? "http://localhost:8709",
        // Stripe publishable (platform) key — NOT a secret; left blank until configured per env.
        stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY ?? "",
        stripeMerchantId: STRIPE_MERCHANT_ID,
        terminalSimulated: (env.STRIPE_TERMINAL_SIMULATED ?? "true") === "true",
    },
};

export default config;
