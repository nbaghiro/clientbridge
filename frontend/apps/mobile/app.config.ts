import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ExpoConfig } from "expo/config";

// expo-modules-core widens ProcessEnv's values to any; config values are strings or unset.
const env: Record<string, string | undefined> = process.env;

// EAS variables from infra/pulumi/mobile_init.py, read alike by builds and updates so runtimes match
const APP_ID = env.APP_ID;
const BASE_DOMAIN = env.BASE_DOMAIN;
const EAS_PROJECT_ID = "f546baca-30f8-4528-811a-a8ae804585bc";

// without them a staging or store build would ship the local app id and development URLs
if (["staging", "production"].includes(env.EAS_BUILD_PROFILE ?? "") && !(APP_ID && BASE_DOMAIN)) {
    throw new Error(
        `the ${env.EAS_BUILD_PROFILE ?? ""} build profile needs APP_ID and BASE_DOMAIN`,
    );
}

// the auth service is at api.<base>/auth
const deployed = (host: string, path = ""): string | undefined =>
    BASE_DOMAIN ? `https://${host}.${BASE_DOMAIN}${path}` : undefined;

const appId = APP_ID ?? "ca.clientbridge.app";
const googleServices = `./firebase/${appId}.json`;
const hasGoogleServices = APP_ID !== undefined && existsSync(join(__dirname, googleServices));
// app.<base> lists the app in its association file for passwords and passkeys
const associatedDomains = BASE_DOMAIN
    ? { associatedDomains: [`webcredentials:app.${BASE_DOMAIN}`] }
    : {};
// granted by Apple on request; set per environment once the entitlement is approved
const tapToPay = env.TAP_TO_PAY === "true";

// Apple Pay merchant id for the Stripe SDK (also the iOS in-app-payments entitlement the plugin adds).
const STRIPE_MERCHANT_ID = env.STRIPE_MERCHANT_ID ?? "merchant.ca.clientbridge.app";

// Native modules (op-sqlite, Stripe) need an Expo dev build, not Expo Go; see .docs/engineering.md.
const config: ExpoConfig = {
    name: env.APP_NAME ?? "Clientbridge",
    slug: "clientbridge",
    owner: "clientbridge-ca",
    scheme: "clientbridge",
    version: "0.1.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    // Permission prompts and the display name, per language; Expo writes InfoPlist.strings and strings.xml.
    locales: { en: "./locales/en.json" },
    // the fingerprint covers every native input, so an update reaches only builds it can run on
    runtimeVersion: { policy: "fingerprint" },
    updates: { url: `https://u.expo.dev/${EAS_PROJECT_ID}`, enabled: APP_ID !== undefined },
    ios: {
        supportsTablet: true,
        bundleIdentifier: appId,
        ...associatedDomains,
        entitlements: tapToPay
            ? { "com.apple.developer.proximity-reader.payment.acceptance": true }
            : {},
        config: { usesNonExemptEncryption: false },
        infoPlist: { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } },
    },
    android: {
        package: appId,
        // Firebase's file for push, written from the cloud stack by mobile_init.py and committed
        ...(hasGoogleServices ? { googleServicesFile: googleServices } : {}),
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
        // Tap to Pay; tapToPayCheck keeps Android's separate Tap to Pay process from starting the app
        ["@stripe/stripe-terminal-react-native", { tapToPayCheck: true }],
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
        eas: { projectId: EAS_PROJECT_ID },
    },
};

export default config;
