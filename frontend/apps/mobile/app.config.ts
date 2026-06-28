import type { ExpoConfig } from "expo/config";

// op-sqlite is a native module → run via Expo dev build / EAS Build, NOT Expo Go (see docs/sync.md).
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
    extra: {
        apiUrl: process.env.API_URL ?? "http://localhost:8701",
        powersyncUrl: process.env.POWERSYNC_URL ?? "http://localhost:8704",
        publicWebUrl: process.env.PUBLIC_WEB_URL ?? "https://app.clientbridge.ca",
    },
};

export default config;
